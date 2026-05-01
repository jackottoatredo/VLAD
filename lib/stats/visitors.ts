import { supabase } from "@/lib/db/supabase";
import { lookupGeo } from "@/lib/stats/geoLookup";

// Upsert a row in vlad_engagement_visitors. Called from logEngagementEvent
// whenever an event arrives with a visitor_id and isn't bot traffic.
//
// First sight ever for a visitor:
//   1. SELECT misses → call iplocate (cached per IP) → INSERT a fresh
//      row with geo, UA, device, first_seen, last_seen all populated.
//
// Subsequent events:
//   2. SELECT hits → just UPDATE last_seen_at and ip_hash. Geo/UA/device
//      stay locked at first-sight values; we don't re-enrich.
//
// Race: two concurrent first-sight inserts for the same visitor_id
// collide on the PK. The second INSERT errors with code '23505'; we
// catch and fall back to UPDATE. Acceptable extra iplocate call (rare).
//
// All errors swallowed — analytics must never block user flows.

export type UpsertVisitorArgs = {
  visitorId: string;
  ip: string;        // raw IP, fed to lookupGeo (never stored)
  ipHash: string;
  uaFamily: string;
  deviceType: string | null;
};

export async function upsertVisitor(args: UpsertVisitorArgs): Promise<void> {
  try {
    const { data: existing, error: selectErr } = await supabase
      .from("vlad_engagement_visitors")
      .select("visitor_id")
      .eq("visitor_id", args.visitorId)
      .maybeSingle();
    if (selectErr) {
      console.error(
        `[visitors] select failed for ${args.visitorId}:`,
        selectErr.message,
      );
      return;
    }

    const nowIso = new Date().toISOString();

    if (existing) {
      const { error: updateErr } = await supabase
        .from("vlad_engagement_visitors")
        .update({ last_seen_at: nowIso, ip_hash: args.ipHash })
        .eq("visitor_id", args.visitorId);
      if (updateErr) {
        console.error(
          `[visitors] update failed for ${args.visitorId}:`,
          updateErr.message,
        );
      }
      return;
    }

    // First sight — enrich with iplocate and INSERT.
    const geo = await lookupGeo(args.ip);
    const row = {
      visitor_id: args.visitorId,
      ip_hash: args.ipHash,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,
      ua_family: args.uaFamily,
      device_type: args.deviceType,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    };
    const { error: insertErr } = await supabase
      .from("vlad_engagement_visitors")
      .insert(row);
    if (!insertErr) return;

    // Race: someone else just created the row. Fall back to UPDATE so
    // the timestamp + ip_hash are still touched.
    if (insertErr.code === "23505") {
      const { error: fallbackErr } = await supabase
        .from("vlad_engagement_visitors")
        .update({ last_seen_at: nowIso, ip_hash: args.ipHash })
        .eq("visitor_id", args.visitorId);
      if (fallbackErr) {
        console.error(
          `[visitors] race-recovery update failed for ${args.visitorId}:`,
          fallbackErr.message,
        );
      }
      return;
    }
    console.error(
      `[visitors] insert failed for ${args.visitorId}:`,
      insertErr.message,
    );
  } catch (err) {
    console.error(`[visitors] upsert threw for ${args.visitorId}:`, err);
  }
}
