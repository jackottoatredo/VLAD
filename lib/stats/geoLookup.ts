// Country/region resolution via iplocate.io (1000 req/day free tier).
//
// Called only on `visit` events (not on every video/click event) and
// only for non-bot traffic. Repeat IPs hit an in-process LRU before
// going to the network — at our scale this keeps us comfortably inside
// the free quota.
//
// Failures (network, missing key, parse error, quota exceeded) all
// degrade to { country: null, region: null }. The caller should never
// know or care that geo lookup happened.

type Geo = { country: string | null; region: string | null };

const CACHE_MAX = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { geo: Geo; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheGet(ip: string): Geo | null {
  const entry = cache.get(ip);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(ip);
    return null;
  }
  // LRU: re-insert so it's now the most-recent entry.
  cache.delete(ip);
  cache.set(ip, entry);
  return entry.geo;
}

function cacheSet(ip: string, geo: Geo): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ip, { geo, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function lookupGeo(ip: string): Promise<Geo> {
  const cached = cacheGet(ip);
  if (cached) return cached;

  const apiKey = process.env.IPLOCATE_API_KEY;
  if (!apiKey) {
    cacheSet(ip, { country: null, region: null });
    return { country: null, region: null };
  }

  try {
    const url = `https://iplocate.io/api/lookup/${encodeURIComponent(ip)}?apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      // Keep the request short — share-page rendering is on the hot path.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      cacheSet(ip, { country: null, region: null });
      return { country: null, region: null };
    }
    const json = (await res.json()) as { country_code?: unknown; subdivision?: unknown };
    const country = typeof json.country_code === "string" ? json.country_code : null;
    const region = typeof json.subdivision === "string" ? json.subdivision : null;
    const geo: Geo = { country, region };
    cacheSet(ip, geo);
    return geo;
  } catch {
    cacheSet(ip, { country: null, region: null });
    return { country: null, region: null };
  }
}
