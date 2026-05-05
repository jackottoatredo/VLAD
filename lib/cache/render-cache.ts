import Redis from "ioredis";
import { REDIS_CONNECTION } from "@/lib/queue/connection";

const CACHE_TTL_SECONDS = Number(process.env.RENDER_CACHE_TTL ?? 86400); // 24 hours

const g = globalThis as unknown as { __cacheRedis?: Redis };
const redis = (g.__cacheRedis ??= new Redis({
  ...(REDIS_CONNECTION as Record<string, unknown>),
  maxRetriesPerRequest: null,
  lazyConnect: true,
}));

export type QualityTier = "preview" | "full";

/**
 * v3 cache: three sub-stages keyed under one Redis hash per (user, recording,
 * url, tier). Trim is INTENTIONALLY excluded from `specHash` so trim-only
 * edits short-circuit at the trim sub-stage — render and composite caches
 * stay warm and only the cheap trim re-encode runs.
 *
 *   render:${specHash}_*           — Playwright capture (overlay baked in)
 *   comp:${specHash}_*             — audio mux on top of render
 *   trim:${specHash}:${trimKey}_*  — final cut to the requested window
 *
 * Bumped from v2 prefix on the cache version to invalidate stale entries
 * carried over from the prior collapse experiment.
 */
const CACHE_VERSION = "v3";

function cacheKey(userId: string, safeId: string, urlHash: string, tier: QualityTier): string {
  return `cache:${CACHE_VERSION}:${userId}:${safeId}:${urlHash}:${tier}`;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

export type CachedRender = {
  /** Earliest pipeline step that needs to run (1=render, 2=composite, 3=trim). */
  startFromStep: 1 | 2 | 3;
  renderR2Key?: string;
  renderDurationMs?: number;
  compositeR2Key?: string;
  trimmedR2Key?: string;
};

/**
 * Look up cached artifacts. Returns the deepest stage that is cached so the
 * worker (or the route's short-circuit) can skip everything earlier.
 *
 * `specHash` is the spec hash WITHOUT trim (see specHashInput) so different
 * trim values share render+composite. `trimKey` differentiates the trim
 * sub-stage.
 */
export async function findCachedRender(
  userId: string,
  safeId: string,
  urlHash: string,
  mouseHash: string,
  specHash: string,
  trimKey: string,
  tier: QualityTier,
): Promise<CachedRender> {
  const key = cacheKey(userId, safeId, urlHash, tier);
  const data = await redis.hgetall(key);

  // No cache entry, or mouse events changed → full render.
  if (!data.mouseHash || data.mouseHash !== mouseHash) {
    return { startFromStep: 1 };
  }

  const renderR2Key = data[`render:${specHash}_r2_key`];
  const renderDurationMs = data[`render:${specHash}_duration_ms`]
    ? Number(data[`render:${specHash}_duration_ms`])
    : undefined;

  if (!renderR2Key || !renderDurationMs) {
    return { startFromStep: 1 };
  }

  const compositeR2Key = data[`comp:${specHash}_r2_key`];
  if (!compositeR2Key) {
    return { startFromStep: 2, renderR2Key, renderDurationMs };
  }

  const trimmedR2Key = data[`trim:${specHash}:${trimKey}_r2_key`];
  if (!trimmedR2Key) {
    return { startFromStep: 3, renderR2Key, renderDurationMs, compositeR2Key };
  }

  return { startFromStep: 3, renderR2Key, renderDurationMs, compositeR2Key, trimmedR2Key };
}

// ---------------------------------------------------------------------------
// Cache update
// ---------------------------------------------------------------------------

export type RenderCacheResult = {
  renderR2Key: string;
  renderDurationMs: number;
  compositeR2Key: string;
  trimmedR2Key: string | null;
};

export async function updateRenderCache(
  userId: string,
  safeId: string,
  urlHash: string,
  mouseHash: string,
  specHash: string,
  trimKey: string,
  tier: QualityTier,
  result: RenderCacheResult,
): Promise<void> {
  const key = cacheKey(userId, safeId, urlHash, tier);

  const fields: Record<string, string> = {
    mouseHash,
    [`render:${specHash}_r2_key`]: result.renderR2Key,
    [`render:${specHash}_duration_ms`]: String(result.renderDurationMs),
    [`comp:${specHash}_r2_key`]: result.compositeR2Key,
  };

  if (result.trimmedR2Key) {
    fields[`trim:${specHash}:${trimKey}_r2_key`] = result.trimmedR2Key;
  }

  await redis.hset(key, fields);
  await redis.expire(key, CACHE_TTL_SECONDS);
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Remove cached artifacts for a given user + identifier + URL. Call when
 * mouse events change (a new recording replaces the old one).
 */
export async function invalidateRenderCache(
  userId: string,
  safeId: string,
  urlHash: string,
): Promise<void> {
  await redis.del(
    cacheKey(userId, safeId, urlHash, "preview"),
    cacheKey(userId, safeId, urlHash, "full"),
  );
}

/**
 * Remove ALL cached entries for a recording (user + safeId, every url + tier).
 * Used as a safety net when a recording's metadata is edited — guarantees
 * the next render re-reads metadata and produces fresh output, even if
 * something has gone wrong with cache-key differentiation. The natural
 * cache-key flow would normally handle edits without this, but the
 * wholesale wipe makes correctness independent of any subtle key-shape
 * regressions.
 */
export async function invalidateRenderCacheForRecording(
  userId: string,
  safeId: string,
): Promise<void> {
  const pattern = `cache:${CACHE_VERSION}:${userId}:${safeId}:*`;
  const stream = redis.scanStream({ match: pattern, count: 100 });
  const keys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (batch: string[]) => {
      for (const k of batch) keys.push(k);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
