import { supabase } from "@/lib/db/supabase";
import { extractClientIp } from "@/lib/stats/clientIp";
import { hashIp } from "@/lib/stats/ipHash";
import { detectBot, type BotKind } from "@/lib/stats/botDetection";
import { parseUaFamily } from "@/lib/stats/uaFamily";
import { parseDeviceType } from "@/lib/stats/deviceType";
import { parseReferrer, type ReferrerKind } from "@/lib/stats/referrer";
import { lookupGeo } from "@/lib/stats/geoLookup";

export type EngagementType =
  | "visit"
  | "visit_linked"
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
  // Server-side calls (visit, asset_download from the redirect endpoint
  // with no JS access) leave this null and the dashboard falls back to
  // ip_hash for dedup.
  visitorId?: string | null;
  payload?: Record<string, unknown>;
  // Override referrer fields for client-posted events whose Referer
  // header is the share page itself, not the original source. Pass the
  // referrer captured at visit time.
  override?: Partial<{ referrerHost: string; referrerKind: ReferrerKind }>;
};

// Append a row to vlad_engagement_events. Errors are swallowed —
// engagement logging must never break the share page or block a redirect.
// Safe to await or fire-and-forget via `void logEngagementEvent(...)`.
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
    // Device type is meaningless for bots, leave null so dashboards don't
    // pollute the mobile/desktop split with unfurl traffic.
    const deviceType = isBot ? null : parseDeviceType(ua);
    const refHeader = args.headers.get("referer");
    const ref = parseReferrer(refHeader);
    // Prefer x-forwarded-host (Railway proxy preserves the original) over
    // the post-proxy Host header. Useful for splitting dashboard data by
    // environment (localhost vs beta vs prod).
    const host =
      args.headers.get("x-forwarded-host") ?? args.headers.get("host") ?? null;

    let country: string | null = null;
    let region: string | null = null;
    if (args.type === "visit" && !isBot) {
      // Only `visit` events spend iplocate quota; downstream events
      // (video_play, clicks) inherit nothing — the dashboard joins
      // them to the visit row by ip_hash + slug.
      const geo = await lookupGeo(ip);
      country = geo.country;
      region = geo.region;
    }

    const referrerHost = args.override?.referrerHost ?? ref.host;
    const referrerKind: ReferrerKind = args.override?.referrerKind ?? ref.kind;

    const row = {
      type: args.type,
      slug: args.slug,
      host,
      visitor_id: args.visitorId ?? null,
      ip_hash: ipHash,
      is_bot: isBot,
      bot_kind: kind,
      ua_family: uaFamily,
      device_type: deviceType,
      country,
      region,
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
