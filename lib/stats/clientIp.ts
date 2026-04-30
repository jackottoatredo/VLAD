// Extract a single client IP from request headers. Railway sets
// `x-forwarded-for`; we take the leftmost entry (the original client) and
// fall back to `x-real-ip`. In production, loopback and private ranges are
// rejected so dev traffic from a shared environment doesn't pollute the
// dataset. In dev (NODE_ENV !== 'production') we accept them so localhost
// testing actually produces rows; rows from dev are still tagged via
// their hash and can be excluded from dashboards if needed.

const IPV4_RE = /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;
// Loose IPv6 matcher — good enough to weed out garbage; we don't need to
// fully validate (the hash takes any string).
const IPV6_RE = /^[0-9a-f:]+$/i;

const LOCAL_DEV_FALLBACK_IP = "127.0.0.1";

function isPrivateOrLoopback(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // IPv6 ULA
  if (ip.startsWith("fe80:")) return true; // IPv6 link-local
  return false;
}

function looksLikeIp(ip: string): boolean {
  return IPV4_RE.test(ip) || IPV6_RE.test(ip);
}

function acceptable(ip: string): boolean {
  if (!looksLikeIp(ip)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return !isPrivateOrLoopback(ip);
}

export function extractClientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && acceptable(first)) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real && acceptable(real)) return real;
  // In dev there are often no proxy headers at all (Next.js dev server
  // omits x-forwarded-for entirely). Fall back to a stable loopback
  // sentinel so engagement events log instead of dropping.
  if (process.env.NODE_ENV !== "production") return LOCAL_DEV_FALLBACK_IP;
  return null;
}
