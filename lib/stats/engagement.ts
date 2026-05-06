import { supabase } from "@/lib/db/supabase";
import { extractClientIp } from "@/lib/stats/clientIp";
import { hashIp } from "@/lib/stats/ipHash";
import { detectBot, type BotKind } from "@/lib/stats/botDetection";
import { parseUaFamily } from "@/lib/stats/uaFamily";
import { parseDeviceType } from "@/lib/stats/deviceType";
import { parseReferrer, type ReferrerKind } from "@/lib/stats/referrer";
import { upsertVisitor } from "@/lib/stats/visitors";

export type EngagementType =
  | "bot_visit"
  | "human_visit"
  | "video_play"
  | "video_pause"
  | "video_quartile"
  | "video_end"
  | "click_copy_link"
  | "click_book_demo"
  | "click_interactive_demo"
  | "asset_download";

export type LogEngagementArgs = {
  type: EngagementType;
  slug: string;
  // Pass the request headers; the helper extracts ip/UA/referrer itself
  // so every call site goes through the same bot detection and hashing.
  headers: Headers;
  // Per-browser stable identifier read from localStorage on the client.
  // Server-side calls (bot `visit` rows, asset_download fired without
  // ?v=) leave this null. Events with a visitor_id additionally trigger
  // an upsert of the visitor profile row (geo enrichment on first
  // sight, last_seen + ip_hash refresh thereafter).
  visitorId?: string | null;
  payload?: Record<string, unknown>;
  // Override referrer fields for client-posted events whose Referer
  // header is the share page itself, not the original source. Pass the
  // referrer captured at visit time.
  override?: Partial<{ referrerHost: string; referrerKind: ReferrerKind }>;
};

// Append a row to vlad_engagement_events AND keep the matching visitor
// profile in vlad_engagement_visitors fresh. Errors are swallowed —
// engagement logging must never break the share page or block a redirect.
// Safe to await or fire-and-forget via `void logEngagementEvent(...)`.
//
// Per-event row carries only the fields that vary per-event (ip_hash,
// referrer, host, payload, bot_kind). Stable per-visitor attributes
// (geo, ua_family, device_type) live on the visitor row; aggregations
// JOIN through visitor_id when they need them.
//
// All branches that drop an event log an explicit warning so you can see
// in the dev server output why nothing's landing in the DB.
export async function logEngagementEvent(args: LogEngagementArgs): Promise<void> {
  try {
    const ip = extractClientIp(args.headers);
    if (!ip) {
      console.warn(
        `[engagement] dropped ${args.type}/${args.slug}: no usable client IP ` +
          `(x-forwarded-for=${args.headers.get("x-forwarded-for") ?? "null"}, ` +
          `x-real-ip=${args.headers.get("x-real-ip") ?? "null"})`,
      );
      return;
    }
    const ipHash = hashIp(ip);
    const ua = args.headers.get("user-agent");
    const { isBot, kind } = detectBot(ua);
    const uaFamily = parseUaFamily(ua);
    // Device type is meaningless for bots; visitor row stays null.
    const deviceType = isBot ? null : parseDeviceType(ua);
    const refHeader = args.headers.get("referer");
    const ref = parseReferrer(refHeader);
    // Prefer x-forwarded-host (Railway proxy preserves the original) over
    // the post-proxy Host header. Useful for splitting dashboard data by
    // environment (localhost vs beta vs prod).
    const host =
      args.headers.get("x-forwarded-host") ?? args.headers.get("host") ?? null;

    const referrerHost = args.override?.referrerHost ?? ref.host;
    const referrerKind: ReferrerKind = args.override?.referrerKind ?? ref.kind;

    // Visitor profile MUST be upserted before the event insert. The
    // events table has an FK on visitor_id → vlad_engagement_visitors,
    // and Supabase JS doesn't wrap the two writes in a single
    // transaction (the FK is DEFERRABLE but DEFERRED only matters
    // intra-transaction). If we insert the event first, the very first
    // beacon from a new visitor — visit_linked on page-mount — fails
    // FK and silently drops, leaving funnel/visit metrics empty even
    // though the visitor row gets created on the same call.
    if (args.visitorId && !isBot) {
      await upsertVisitor({
        visitorId: args.visitorId,
        ip,
        ipHash,
        uaFamily,
        deviceType,
      });
    }

    const row = {
      type: args.type,
      slug: args.slug,
      host,
      visitor_id: args.visitorId ?? null,
      ip_hash: ipHash,
      is_bot: isBot,
      bot_kind: kind,
      referrer_host: referrerHost,
      referrer_kind: referrerKind,
      payload: args.payload ?? {},
    };
    const { error } = await supabase.from("vlad_engagement_events").insert(row);
    if (error) {
      console.error(
        `[engagement] insert failed for ${args.type}/${args.slug}:`,
        error.message,
        "row=",
        row,
      );
    } else if (process.env.NODE_ENV !== "production") {
      console.log(`[engagement] logged ${args.type}/${args.slug}`);
    }
  } catch (err) {
    console.error(`[engagement] insert threw for ${args.type}/${args.slug}:`, err);
  }
}

export type { BotKind, ReferrerKind };
