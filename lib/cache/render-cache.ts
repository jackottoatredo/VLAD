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
 * v2 cache: keyed on URL hash + tier. Composite/trim sub-fields are keyed on
 * `specHash` (a hash of the resolved RenderSpec excluding trim) so each
 * settings combination caches independently. Bumped from v1 (which keyed
 * on legacy webcam-only fingerprint) so old entries are invalidated.
 */
const CACHE_VERSION = "v2";

function cacheKey(userId: string, safeId: string, urlHash: string, tier: QualityTier): string {
  return `cache:${CACHE_VERSION}:${userId}:${safeId}:${urlHash}:${tier}`;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

export type CachedRender = {
  startFromStep: 1 | 2 | 3;
  renderR2Key?: string;
  renderDurationMs?: number;
  compositeR2Key?: string;
  trimmedR2Key?: string;
};

/**
 * Look up cached render artifacts in Redis. Returns the earliest pipeline
 * step that needs to run, plus any cached R2 keys.
 *
 * `specHash` is a stable hash of the resolved RenderSpec sans trim — a
 * change in webcam mode/position, throb settings, morph, or mouse handoff
 * invalidates stage 1+2.
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

  if (!data.mouseHash || data.mouseHash !== mouseHash) {
    return { startFromStep: 1 };
  }

  // Render is keyed solely on (url, mouse) — overlay is in stage 1 now,
  // so we need spec to match the cached render too.
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
 * Remove all cached artifacts for a given user + identifier + URL.
 * Call when mouse events change (new recording replaces old one).
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
