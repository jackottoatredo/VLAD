import Redis from "ioredis";
import { REDIS_CONNECTION } from "@/lib/queue/connection";

const CACHE_TTL_SECONDS = Number(process.env.RENDER_CACHE_TTL ?? 86400); // 24 hours

// Shared IORedis instance for cache operations (separate from BullMQ's internal connections)
const g = globalThis as unknown as { __cacheRedis?: Redis };
const redis = (g.__cacheRedis ??= new Redis({
  host: REDIS_CONNECTION.host,
  port: REDIS_CONNECTION.port,
  maxRetriesPerRequest: null,
  lazyConnect: true,
}));

function cacheKey(presenter: string, safeId: string, urlHash: string): string {
  return `cache:${presenter}:${safeId}:${urlHash}`;
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
 * Look up cached render artifacts in Redis.
 * Returns the earliest pipeline step that needs to run, plus any cached R2 keys.
 */
export async function findCachedRender(
  presenter: string,
  safeId: string,
  urlHash: string,
  mouseHash: string,
  wcFingerprint: string,
  trimKey: string,
): Promise<CachedRender> {
  const key = cacheKey(presenter, safeId, urlHash);
  const data = await redis.hgetall(key);

  // No cache entry, or mouse events changed → full render
  if (!data.mouseHash || data.mouseHash !== mouseHash) {
    return { startFromStep: 1 };
  }

  const renderR2Key = data.render_r2_key;
  const renderDurationMs = data.render_duration_ms ? Number(data.render_duration_ms) : undefined;

  if (!renderR2Key || !renderDurationMs) {
    return { startFromStep: 1 };
  }

  // Render cached — check composite
  const compositeR2Key = data[`comp:${wcFingerprint}_r2_key`];
  if (!compositeR2Key) {
    return { startFromStep: 2, renderR2Key, renderDurationMs };
  }

  // Composite cached — check trim
  const trimmedR2Key = data[`trim:${trimKey}_r2_key`];
  if (!trimmedR2Key) {
    return { startFromStep: 3, renderR2Key, renderDurationMs, compositeR2Key };
  }

  // Fully cached
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

/**
 * Store render artifacts in Redis cache after a successful render.
 */
export async function updateRenderCache(
  presenter: string,
  safeId: string,
  urlHash: string,
  mouseHash: string,
  wcFingerprint: string,
  trimKey: string,
  result: RenderCacheResult,
): Promise<void> {
  const key = cacheKey(presenter, safeId, urlHash);

  const fields: Record<string, string> = {
    mouseHash,
    render_r2_key: result.renderR2Key,
    render_duration_ms: String(result.renderDurationMs),
    [`comp:${wcFingerprint}_r2_key`]: result.compositeR2Key,
  };

  if (result.trimmedR2Key) {
    fields[`trim:${trimKey}_r2_key`] = result.trimmedR2Key;
  }

  await redis.hset(key, fields);
  await redis.expire(key, CACHE_TTL_SECONDS);
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Remove all cached artifacts for a given presenter + identifier + URL.
 * Call when mouse events change (new recording replaces old one).
 */
export async function invalidateRenderCache(
  presenter: string,
  safeId: string,
  urlHash: string,
): Promise<void> {
  await redis.del(cacheKey(presenter, safeId, urlHash));
}
