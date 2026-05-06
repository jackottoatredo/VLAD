import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { extractClientIp } from "@/lib/stats/clientIp";
import { hashIp } from "@/lib/stats/ipHash";
import { logEngagementEvent, type EngagementType } from "@/lib/stats/engagement";
import type { ReferrerKind } from "@/lib/stats/referrer";

export const runtime = "nodejs";

// Public, unauthenticated endpoint. The three guardrails below exist to
// keep the dataset clean from drive-by garbage:
//
//   1. Slug whitelist — only insert if the slug exists in vlad_renders.
//      Prevents an attacker from inflating arbitrary slugs.
//   2. Per-IP-hash token bucket — caps event volume from one source.
//   3. Strict body validation, drop unknowns silently — no error feedback
//      that would help fuzzers map the schema.
//
// All paths return { ok: true } regardless of whether a row was inserted.

const ALLOWED_TYPES = new Set<EngagementType>([
  "human_visit",
  "video_play",
  "video_pause",
  "video_quartile",
  "video_end",
  "click_copy_link",
]);

// Match the format the client hook generates (crypto.randomUUID) plus a
// little tolerance for older entries. Anything that doesn't match is
// dropped silently — we never want client-supplied junk in the column.
const VISITOR_ID_RE = /^[a-f0-9-]{16,64}$/i;

// Slug existence cache. The vlad_renders table changes infrequently
// relative to share-page traffic; a 60s TTL keeps DB pressure low while
// new slugs still become loggable within a minute of creation.
type SlugCacheEntry = { exists: boolean; expiresAt: number };
const slugCache = new Map<string, SlugCacheEntry>();
const SLUG_CACHE_TTL_MS = 60 * 1000;

async function slugExists(slug: string): Promise<boolean> {
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;
  const { data } = await supabase
    .from("vlad_renders")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  const exists = !!data;
  slugCache.set(slug, { exists, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return exists;
}

// Token bucket: 60 events / 5 min per ip_hash, in-memory per instance.
// Cross-instance coordination is overkill for v1 — an attacker spreading
// across instances still hits each one's cap independently.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

function isRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ipHash);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    buckets.set(ipHash, { count: 1, windowStart: now });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX;
}

type Body = {
  type?: unknown;
  slug?: unknown;
  payload?: unknown;
  // Original referrer captured client-side at visit time. The Referer
  // header on this request is the share page itself, which would
  // overwrite the useful "this came from Slack" signal.
  originalReferrer?: unknown;
  // Per-browser stable ID generated client-side and kept in localStorage.
  visitorId?: unknown;
};

function parseReferrerHostFromUrl(url: string): { host: string | null; kind: ReferrerKind } {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Lightweight categorization that mirrors lib/stats/referrer.ts. Kept
    // inline to avoid leaking the full categorizer to client request input.
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { host, kind: "localhost" };
    }
    if (host === "slack.com" || host === "app.slack.com" || host.endsWith(".slack.com")) {
      return { host, kind: "slack" };
    }
    if (host === "linkedin.com" || host === "lnkd.in" || host.endsWith(".linkedin.com")) {
      return { host, kind: "linkedin" };
    }
    if (host === "twitter.com" || host === "x.com" || host === "t.co" || host.endsWith(".twitter.com")) {
      return { host, kind: "twitter" };
    }
    if (
      host === "mail.google.com" ||
      host.startsWith("outlook.") ||
      host === "mail.yahoo.com"
    ) {
      return { host, kind: "email" };
    }
    return { host, kind: "other" };
  } catch {
    return { host: null, kind: "direct" };
  }
}

export async function POST(request: Request) {
  // Always succeed silently — we never want client beacons to surface
  // errors that affect the share page UX.
  const ok = NextResponse.json({ ok: true });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return ok;
  }

  if (typeof body.type !== "string" || typeof body.slug !== "string") return ok;
  if (!ALLOWED_TYPES.has(body.type as EngagementType)) return ok;
  if (body.slug.length === 0 || body.slug.length > 200) return ok;

  const ip = extractClientIp(request.headers);
  if (!ip) return ok;
  const ipHash = hashIp(ip);

  if (isRateLimited(ipHash)) return ok;
  if (!(await slugExists(body.slug))) return ok;

  const override =
    typeof body.originalReferrer === "string" && body.originalReferrer.length > 0
      ? parseReferrerHostFromUrl(body.originalReferrer)
      : undefined;

  let payload: Record<string, unknown> = {};
  if (body.payload != null && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    payload = body.payload as Record<string, unknown>;
  }
  if (body.type === "video_quartile") {
    const q = (payload as { q?: unknown }).q;
    if (q !== 25 && q !== 50 && q !== 75) return ok; // unknown quartile → drop silently
  }

  const visitorId =
    typeof body.visitorId === "string" && VISITOR_ID_RE.test(body.visitorId)
      ? body.visitorId
      : null;

  void logEngagementEvent({
    type: body.type as EngagementType,
    slug: body.slug,
    headers: request.headers,
    visitorId,
    payload,
    override: override
      ? {
          referrerKind: override.kind,
          ...(override.host != null ? { referrerHost: override.host } : {}),
        }
      : undefined,
  });

  return ok;
}
