import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { MS_PER_DAY, dayKey, buildDateRange } from "@/lib/stats/dateRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERIES_DAYS = 90;

// IP hashes treated as internal — set INTERNAL_IP_HASHES in env as a
// comma-separated list (e.g. "e650bf6e991b6958,abc123..."). Any visit
// with an ip_hash in this set is tagged `internal` in the Referrer
// sources donut, regardless of its actual referrer_kind. Lets the
// dashboard show "this is our team's traffic" as a first-class slice
// without polluting the data on disk. Update freely; the change picks
// up retroactively because it's applied at aggregation time.
const INTERNAL_IP_HASHES = new Set(
  (process.env.INTERNAL_IP_HASHES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Daily visit count split by audience. `bot` includes any visit row with
// is_bot=true (Slackbot/LinkedInBot/etc + generic crawlers). Human visits
// are bucketed by device_type; rows with null/unknown device_type fall
// into `other`.
export type VisitsPoint = {
  date: string;
  bot: number;
  desktop: number;
  mobile: number;
  tablet: number;
  other: number;
};

// Aggregates for the Event counts stat quad. mobilePct is calculated
// against humans only (bots have no meaningful device); botPct is
// against all visit rows. Both are 0-1 ratios, or null when the
// denominator is zero (so the client can render "—" instead of "0%"
// where the distinction matters).
export type EventCounts = {
  totalVisits: number;
  uniqueVisitors: number;
  mobilePct: number | null;
  botPct: number | null;
};

// Stage-by-stage funnel counts. Each value is the COUNT(DISTINCT
// visitor_id) of viewers who reached that stage. Only events with a
// visitor_id contribute (server-side rows like asset_download via the
// download route still count when the redirect carried ?v=). click_any
// merges all four CTA outcomes (copy / book demo / interactive demo /
// download) since they're all "viewer took an action".
export type FunnelCounts = {
  visit_linked: number;
  video_play: number;
  q25: number;
  q50: number;
  q75: number;
  video_end: number;
  click_any: number;
};

// Per-kind visit counts grouped for the two "where shared" donuts.
// `unfurlBots` aggregates is_bot=true visits by bot_kind (Slackbot /
// LinkedInBot / etc.); `referrers` aggregates is_bot=false visits by
// referrer_kind (slack / linkedin / email / direct / other). Both
// arrays are sorted descending by count.
export type SharedBreakdownEntry = { kind: string; count: number };
export type SharedBreakdown = {
  unfurlBots: SharedBreakdownEntry[];
  referrers: SharedBreakdownEntry[];
};

// Watch drop-off binned by video length. Bins are fixed at 15 seconds
// each from 0 to 180, plus a 180+s overflow bucket — chart always
// renders the same brackets regardless of which durations actually
// landed in the data, so empty bins read as gaps instead of vanishing.
//
// Each LengthBin reports the distinct visitor_id count that reached
// each video stage for videos in that length bracket. binEnd is null
// on the overflow bucket (no upper bound). Events without a usable
// duration in payload are excluded — only forward-instrumented client
// beacons contribute.
export type LengthBin = {
  binStart: number;
  binEnd: number | null;
  label: string;
  play: number;
  q25: number;
  q50: number;
  q75: number;
  end: number;
};

// Pause hotspots — a histogram of `currentTime` from video_pause events.
// Two parallel views: `normalized` buckets currentTime/duration into 5%
// brackets (only events with a usable duration contribute); `absolute`
// buckets currentTime into 5s brackets with a 180+s overflow. The
// dashboard toggles between them.
export type PauseBin = {
  binStart: number;
  label: string;
  count: number;
};

export type PauseDropoff = {
  normalized: PauseBin[];
  absolute: PauseBin[];
};

// Geo distribution of human visits. ISO 3166-1 alpha-2 country codes
// from iplocate; bots excluded (we don't run iplocate on them anyway).
// `regions` carries the top 5 subdivisions for hover drill-down.
export type GeoVisitsRegion = { region: string; count: number };
export type GeoVisitsEntry = {
  country: string;
  count: number;
  regions: GeoVisitsRegion[];
};

// City-level visit aggregation for the dot-map view. Lat/lng comes from
// iplocate (city centroid, not exact IP location). Aggregated by
// `${country}|${region}|${city}` so "Springfield, IL" and "Springfield,
// MO" stay separate. Sorted desc by count.
export type CityVisitsEntry = {
  country: string;
  region: string | null;
  city: string;
  lat: number;
  lng: number;
  count: number;
};

export type EngagementResponse = {
  // 90-day window. Cards slice client-side via the SegmentedControl.
  seriesDays: number;
  visitsSeries: VisitsPoint[];
  // Pre-computed for each window option so the client just picks one.
  // 7/30/90 are derived in-memory from the same 90d query that backs
  // visitsSeries; allTime comes from separate count queries.
  eventCounts: {
    last7d: EventCounts;
    last30d: EventCounts;
    last90d: EventCounts;
    allTime: EventCounts;
  };
  funnel: {
    last7d: FunnelCounts;
    last30d: FunnelCounts;
    last90d: FunnelCounts;
    allTime: FunnelCounts;
  };
  sharedBreakdown: {
    last7d: SharedBreakdown;
    last30d: SharedBreakdown;
    last90d: SharedBreakdown;
    allTime: SharedBreakdown;
  };
  lengthBinDropoff: {
    last7d: LengthBin[];
    last30d: LengthBin[];
    last90d: LengthBin[];
    allTime: LengthBin[];
  };
  pauseDropoff: {
    last7d: PauseDropoff;
    last30d: PauseDropoff;
    last90d: PauseDropoff;
    allTime: PauseDropoff;
  };
  geoVisits: {
    last7d: GeoVisitsEntry[];
    last30d: GeoVisitsEntry[];
    last90d: GeoVisitsEntry[];
    allTime: GeoVisitsEntry[];
  };
  cityVisits: {
    last7d: CityVisitsEntry[];
    last30d: CityVisitsEntry[];
    last90d: CityVisitsEntry[];
    allTime: CityVisitsEntry[];
  };
};

type EventRow = {
  type: string;
  created_at: string;
  is_bot: boolean;
  bot_kind: string | null;
  device_type: string | null;
  visitor_id: string | null;
  ip_hash: string;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  referrer_kind: string | null;
  payload: Record<string, unknown> | null;
};

// Counters for one window, kept as raw counts so ratios compute at the end.
type Counter = {
  visits: number;
  bots: number;
  humans: number;
  mobile: number;
  visitorIds: Set<string>;
};

function makeCounter(): Counter {
  return { visits: 0, bots: 0, humans: 0, mobile: 0, visitorIds: new Set() };
}

function counterToCounts(c: Counter): EventCounts {
  return {
    totalVisits: c.visits,
    uniqueVisitors: c.visitorIds.size,
    mobilePct: c.humans > 0 ? c.mobile / c.humans : null,
    botPct: c.visits > 0 ? c.bots / c.visits : null,
  };
}

// Per-stage Sets of visitor_ids for one window. Each Set is "viewers who
// reached this stage at least once in the window."
type FunnelSets = {
  visit_linked: Set<string>;
  video_play: Set<string>;
  q25: Set<string>;
  q50: Set<string>;
  q75: Set<string>;
  video_end: Set<string>;
  click_any: Set<string>;
};

function makeFunnel(): FunnelSets {
  return {
    visit_linked: new Set(),
    video_play: new Set(),
    q25: new Set(),
    q50: new Set(),
    q75: new Set(),
    video_end: new Set(),
    click_any: new Set(),
  };
}

function applyToFunnel(
  f: FunnelSets,
  type: string,
  payload: Record<string, unknown> | null,
  visitorId: string | null,
): void {
  if (!visitorId) return;
  switch (type) {
    case "visit_linked":
      f.visit_linked.add(visitorId);
      return;
    case "video_play":
      f.video_play.add(visitorId);
      return;
    case "video_quartile": {
      const q = payload?.q;
      if (q === 25) f.q25.add(visitorId);
      else if (q === 50) f.q50.add(visitorId);
      else if (q === 75) f.q75.add(visitorId);
      return;
    }
    case "video_end":
      f.video_end.add(visitorId);
      return;
    case "click_copy_link":
    case "click_book_demo":
    case "click_interactive_demo":
    case "asset_download":
      f.click_any.add(visitorId);
      return;
  }
}

function funnelToCounts(f: FunnelSets): FunnelCounts {
  return {
    visit_linked: f.visit_linked.size,
    video_play: f.video_play.size,
    q25: f.q25.size,
    q50: f.q50.size,
    q75: f.q75.size,
    video_end: f.video_end.size,
    click_any: f.click_any.size,
  };
}

// Length-bin accumulator: bin start (seconds: 0, 15, 30, …, 165, 180) →
// per-stage Sets of visitor_ids. Counts unique viewers; replays don't
// inflate the totals.
type LengthBinSets = {
  play: Set<string>;
  q25: Set<string>;
  q50: Set<string>;
  q75: Set<string>;
  end: Set<string>;
};

type LengthBinAcc = Map<number, LengthBinSets>;

const BIN_WIDTH_SECONDS = 15;
const BIN_OVERFLOW_START = 180; // any duration >= this collapses into 180+s
const BIN_MAX_VALID_DURATION = 3600; // sanity cap (1h) — beyond is treated as garbage

function emptyBinSets(): LengthBinSets {
  return {
    play: new Set(),
    q25: new Set(),
    q50: new Set(),
    q75: new Set(),
    end: new Set(),
  };
}

function makeLengthBins(): LengthBinAcc {
  // Pre-populate every bin from 0..165 in 15s steps, plus the 180+
  // overflow bucket. Empty bins still render in the chart so gaps in
  // the data read as visible zero columns rather than vanishing labels.
  const acc: LengthBinAcc = new Map();
  for (let s = 0; s < BIN_OVERFLOW_START; s += BIN_WIDTH_SECONDS) {
    acc.set(s, emptyBinSets());
  }
  acc.set(BIN_OVERFLOW_START, emptyBinSets());
  return acc;
}

function durationToBinStart(dur: number): number | null {
  if (!Number.isFinite(dur) || dur <= 0 || dur > BIN_MAX_VALID_DURATION) return null;
  if (dur >= BIN_OVERFLOW_START) return BIN_OVERFLOW_START;
  return Math.floor(dur / BIN_WIDTH_SECONDS) * BIN_WIDTH_SECONDS;
}

// Discards events without a usable duration so the binned chart never
// misclassifies them. Older rows from before duration was instrumented
// simply don't appear.
function applyToLengthBins(
  acc: LengthBinAcc,
  type: string,
  payload: Record<string, unknown> | null,
  visitorId: string | null,
): void {
  if (!visitorId) return;
  const dur = payload?.duration;
  if (typeof dur !== "number") return;
  const binStart = durationToBinStart(dur);
  if (binStart == null) return;
  // makeLengthBins pre-populates every bin, so this lookup is always
  // a hit; defensive ?? in case a future caller skips pre-population.
  const bin = acc.get(binStart) ?? emptyBinSets();
  if (!acc.has(binStart)) acc.set(binStart, bin);
  switch (type) {
    case "video_play":
      bin.play.add(visitorId);
      return;
    case "video_quartile": {
      const q = payload?.q;
      if (q === 25) bin.q25.add(visitorId);
      else if (q === 50) bin.q50.add(visitorId);
      else if (q === 75) bin.q75.add(visitorId);
      return;
    }
    case "video_end":
      bin.end.add(visitorId);
      return;
  }
}

function lengthBinsToArray(acc: LengthBinAcc): LengthBin[] {
  return [...acc.entries()]
    .map(([binStart, sets]) => {
      const isOverflow = binStart === BIN_OVERFLOW_START;
      return {
        binStart,
        binEnd: isOverflow ? null : binStart + BIN_WIDTH_SECONDS,
        label: isOverflow
          ? `${BIN_OVERFLOW_START}+s`
          : `${binStart}–${binStart + BIN_WIDTH_SECONDS}s`,
        play: sets.play.size,
        q25: sets.q25.size,
        q50: sets.q50.size,
        q75: sets.q75.size,
        end: sets.end.size,
      };
    })
    .sort((a, b) => a.binStart - b.binStart);
}

// Pause hotspots — counts (not Sets, since multiple pauses by the same
// viewer at different positions are all meaningful).
type PauseDropoffAcc = {
  normalized: Map<number, number>;
  absolute: Map<number, number>;
};

const PAUSE_NORMALIZED_BIN_WIDTH = 5; // %
const PAUSE_ABSOLUTE_BIN_WIDTH = 5; // seconds
const PAUSE_ABSOLUTE_OVERFLOW = 180; // seconds — anything later collapses here

function makePauseDropoff(): PauseDropoffAcc {
  const normalized = new Map<number, number>();
  const absolute = new Map<number, number>();
  for (let p = 0; p < 100; p += PAUSE_NORMALIZED_BIN_WIDTH) {
    normalized.set(p, 0);
  }
  for (let s = 0; s < PAUSE_ABSOLUTE_OVERFLOW; s += PAUSE_ABSOLUTE_BIN_WIDTH) {
    absolute.set(s, 0);
  }
  absolute.set(PAUSE_ABSOLUTE_OVERFLOW, 0);
  return { normalized, absolute };
}

function applyToPauseDropoff(
  acc: PauseDropoffAcc,
  payload: Record<string, unknown> | null,
): void {
  const ct = payload?.currentTime;
  if (typeof ct !== "number" || !Number.isFinite(ct) || ct < 0) return;

  // Absolute bucket — always populated (currentTime is on every pause).
  const absStart =
    ct >= PAUSE_ABSOLUTE_OVERFLOW
      ? PAUSE_ABSOLUTE_OVERFLOW
      : Math.floor(ct / PAUSE_ABSOLUTE_BIN_WIDTH) * PAUSE_ABSOLUTE_BIN_WIDTH;
  acc.absolute.set(absStart, (acc.absolute.get(absStart) ?? 0) + 1);

  // Normalized bucket — only when duration is captured. Older events
  // (pre duration-on-beacon) are excluded from the % view but still
  // count in absolute seconds.
  const dur = payload?.duration;
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0) return;
  // Cap below 100 so a pause exactly at the end lands in the 95% bin
  // instead of overflowing.
  const pct = Math.min(99.999, (ct / dur) * 100);
  if (pct < 0) return;
  const normStart =
    Math.floor(pct / PAUSE_NORMALIZED_BIN_WIDTH) * PAUSE_NORMALIZED_BIN_WIDTH;
  acc.normalized.set(normStart, (acc.normalized.get(normStart) ?? 0) + 1);
}

function pauseDropoffToOutput(acc: PauseDropoffAcc): PauseDropoff {
  const sortAsc = (a: PauseBin, b: PauseBin) => a.binStart - b.binStart;
  return {
    normalized: [...acc.normalized.entries()]
      .map(([binStart, count]) => ({
        binStart,
        label: `${binStart}–${binStart + PAUSE_NORMALIZED_BIN_WIDTH}%`,
        count,
      }))
      .sort(sortAsc),
    absolute: [...acc.absolute.entries()]
      .map(([binStart, count]) => ({
        binStart,
        label:
          binStart === PAUSE_ABSOLUTE_OVERFLOW
            ? `${PAUSE_ABSOLUTE_OVERFLOW}+s`
            : `${binStart}–${binStart + PAUSE_ABSOLUTE_BIN_WIDTH}s`,
        count,
      }))
      .sort(sortAsc),
  };
}

// Slight misnomer at this point — these are the engagement-detail event
// types fetched in one query so funnel, length-bin dropoff, and pause
// hotspots all share the read. video_pause doesn't feed the funnel
// itself; it's bucketed into the pause histogram below.
const FUNNEL_TYPES = [
  "visit_linked",
  "video_play",
  "video_pause",
  "video_quartile",
  "video_end",
  "click_copy_link",
  "click_book_demo",
  "click_interactive_demo",
  "asset_download",
] as const;

// Per-window accumulator for the two share-breakdown donuts. Maps are
// kind → count; ordering is recovered when serialized into the API
// response (sorted descending).
type SharedAccumulator = {
  bot: Map<string, number>;
  ref: Map<string, number>;
};

function makeShared(): SharedAccumulator {
  return { bot: new Map(), ref: new Map() };
}

function applyToShared(
  s: SharedAccumulator,
  isBot: boolean,
  botKind: string | null,
  refKind: string | null,
  ipHash: string,
): void {
  if (isBot) {
    const k = botKind ?? "unknown";
    s.bot.set(k, (s.bot.get(k) ?? 0) + 1);
  } else {
    // Internal traffic gets its own slice regardless of where the Referer
    // header would categorize it. Lets us see team usage as a distinct
    // segment instead of inflating direct/localhost/other.
    const k = INTERNAL_IP_HASHES.has(ipHash)
      ? "internal"
      : (refKind ?? "direct");
    s.ref.set(k, (s.ref.get(k) ?? 0) + 1);
  }
}

function sharedToBreakdown(s: SharedAccumulator): SharedBreakdown {
  const sortDesc = (
    a: SharedBreakdownEntry,
    b: SharedBreakdownEntry,
  ): number => b.count - a.count;
  return {
    unfurlBots: [...s.bot.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort(sortDesc),
    referrers: [...s.ref.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort(sortDesc),
  };
}

// Geo accumulator: country code → { total visits, region breakdown }.
// Bots and rows without country are skipped at apply time.
type GeoAcc = Map<string, { count: number; regions: Map<string, number> }>;

const REGIONS_PER_COUNTRY_LIMIT = 5;

function makeGeo(): GeoAcc {
  return new Map();
}

function applyToGeo(
  acc: GeoAcc,
  isBot: boolean,
  country: string | null,
  region: string | null,
): void {
  if (isBot || !country) return;
  let entry = acc.get(country);
  if (!entry) {
    entry = { count: 0, regions: new Map() };
    acc.set(country, entry);
  }
  entry.count++;
  if (region) {
    entry.regions.set(region, (entry.regions.get(region) ?? 0) + 1);
  }
}

function geoToOutput(acc: GeoAcc): GeoVisitsEntry[] {
  return [...acc.entries()]
    .map(([country, { count, regions }]) => ({
      country,
      count,
      regions: [...regions.entries()]
        .map(([region, regionCount]) => ({ region, count: regionCount }))
        .sort((a, b) => b.count - a.count)
        .slice(0, REGIONS_PER_COUNTRY_LIMIT),
    }))
    .sort((a, b) => b.count - a.count);
}

// City accumulator: composite key keeps "Springfield, IL" and
// "Springfield, MO" distinct. Stores the lat/lng of the first occurrence
// — iplocate returns the same city centroid per IP, so subsequent
// updates would write the same value anyway.
type CityAcc = Map<
  string,
  {
    country: string;
    region: string | null;
    city: string;
    lat: number;
    lng: number;
    count: number;
  }
>;

function makeCity(): CityAcc {
  return new Map();
}

function applyToCity(
  acc: CityAcc,
  isBot: boolean,
  country: string | null,
  region: string | null,
  city: string | null,
  lat: number | null,
  lng: number | null,
): void {
  if (isBot) return;
  if (!country || !city || lat == null || lng == null) return;
  const key = `${country}|${region ?? ""}|${city}`;
  const entry = acc.get(key);
  if (entry) {
    entry.count++;
  } else {
    acc.set(key, { country, region, city, lat, lng, count: 1 });
  }
}

function cityToOutput(acc: CityAcc): CityVisitsEntry[] {
  return [...acc.values()].sort((a, b) => b.count - a.count);
}

// All-time distinct visitor count via paginated fetch — Supabase JS
// can't compute COUNT(DISTINCT) directly without an RPC. At v1 volume
// this is a few KB; revisit with an RPC if the table grows past ~100k
// visit_linked rows.
async function fetchAllTimeUniqueVisitors(): Promise<number> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("vlad_engagement_events")
      .select("visitor_id")
      .eq("type", "visit_linked")
      .not("visitor_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      if (typeof r.visitor_id === "string") ids.add(r.visitor_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return ids.size;
}

// All-time shared-breakdown + geo + city built by paginating every visit
// row. Three accumulators filled in the same pass to avoid duplicate
// queries. Same scaling caveat as fetchAllTimeUniqueVisitors — fine at
// v1 volume.
async function fetchAllTimeSharedAndGeo(): Promise<{
  shared: SharedAccumulator;
  geo: GeoAcc;
  city: CityAcc;
}> {
  const s = makeShared();
  const g = makeGeo();
  const c = makeCity();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("vlad_engagement_events")
      .select(
        "is_bot, bot_kind, referrer_kind, ip_hash, country, region, city, latitude, longitude",
      )
      .eq("type", "visit")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as {
      is_bot: boolean;
      bot_kind: string | null;
      referrer_kind: string | null;
      ip_hash: string;
      country: string | null;
      region: string | null;
      city: string | null;
      latitude: number | null;
      longitude: number | null;
    }[]) {
      applyToShared(s, r.is_bot, r.bot_kind, r.referrer_kind, r.ip_hash);
      applyToGeo(g, r.is_bot, r.country, r.region);
      applyToCity(c, r.is_bot, r.country, r.region, r.city, r.latitude, r.longitude);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { shared: s, geo: g, city: c };
}

// All-time funnel + length-bin drop-off + pause hotspots built by
// paginating every engagement-detail row. Three accumulators filled in
// the same pass to avoid duplicate queries. visitor_id filter dropped
// because pauses count regardless of whether localStorage resolved —
// funnel/length-bin functions still gate on visitor_id internally.
async function fetchAllTimeFunnelAndBins(): Promise<{
  funnel: FunnelSets;
  bins: LengthBinAcc;
  pauses: PauseDropoffAcc;
}> {
  const f = makeFunnel();
  const bins = makeLengthBins();
  const pauses = makePauseDropoff();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("vlad_engagement_events")
      .select("type, payload, visitor_id")
      .in("type", FUNNEL_TYPES as unknown as string[])
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as {
      type: string;
      payload: Record<string, unknown> | null;
      visitor_id: string | null;
    }[]) {
      applyToFunnel(f, r.type, r.payload, r.visitor_id);
      applyToLengthBins(bins, r.type, r.payload, r.visitor_id);
      if (r.type === "video_pause") applyToPauseDropoff(pauses, r.payload);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { funnel: f, bins, pauses };
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const since = new Date(Date.now() - SERIES_DAYS * MS_PER_DAY).toISOString();

  // Single read for the 90d window covers visitsSeries, eventCounts,
  // funnel, and sharedBreakdown for 7/30/90. All event types and fields
  // any panel needs are pulled in one query and bucketed in-memory below.
  const { data, error } = await supabase
    .from("vlad_engagement_events")
    .select(
      "type, created_at, is_bot, bot_kind, device_type, visitor_id, ip_hash, country, region, city, latitude, longitude, referrer_kind, payload",
    )
    .in("type", ["visit", ...FUNNEL_TYPES])
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const events = (data ?? []) as EventRow[];

  // ---- Visits series (per-day stack) ----
  const range = buildDateRange(SERIES_DAYS);
  const buckets = new Map<string, VisitsPoint>();
  for (const d of range) {
    buckets.set(d, { date: d, bot: 0, desktop: 0, mobile: 0, tablet: 0, other: 0 });
  }
  for (const e of events) {
    if (e.type !== "visit") continue;
    const point = buckets.get(dayKey(e.created_at));
    if (!point) continue;
    if (e.is_bot) {
      point.bot++;
      continue;
    }
    switch (e.device_type) {
      case "desktop":
        point.desktop++;
        break;
      case "mobile":
        point.mobile++;
        break;
      case "tablet":
        point.tablet++;
        break;
      default:
        point.other++;
    }
  }
  const visitsSeries: VisitsPoint[] = range.map((d) => buckets.get(d)!);

  // ---- Windowed event counts (7d / 30d / 90d) ----
  // Each event contributes to every window it falls inside, so a 5-day-old
  // visit increments c7, c30 and c90 — sums add up correctly.
  const now = Date.now();
  const cutoff7 = now - 7 * MS_PER_DAY;
  const cutoff30 = now - 30 * MS_PER_DAY;
  const cutoff90 = now - 90 * MS_PER_DAY;

  const c7 = makeCounter();
  const c30 = makeCounter();
  const c90 = makeCounter();
  const f7 = makeFunnel();
  const f30 = makeFunnel();
  const f90 = makeFunnel();
  const s7 = makeShared();
  const s30 = makeShared();
  const s90 = makeShared();
  const g7 = makeGeo();
  const g30 = makeGeo();
  const g90 = makeGeo();
  const ci7 = makeCity();
  const ci30 = makeCity();
  const ci90 = makeCity();
  const b7 = makeLengthBins();
  const b30 = makeLengthBins();
  const b90 = makeLengthBins();
  const p7 = makePauseDropoff();
  const p30 = makePauseDropoff();
  const p90 = makePauseDropoff();

  for (const e of events) {
    const ts = new Date(e.created_at).getTime();
    if (e.type === "visit") {
      const apply = (c: Counter) => {
        c.visits++;
        if (e.is_bot) c.bots++;
        else {
          c.humans++;
          if (e.device_type === "mobile") c.mobile++;
        }
      };
      if (ts >= cutoff90) apply(c90);
      if (ts >= cutoff30) apply(c30);
      if (ts >= cutoff7) apply(c7);
      if (ts >= cutoff90)
        applyToShared(s90, e.is_bot, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff30)
        applyToShared(s30, e.is_bot, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff7)
        applyToShared(s7, e.is_bot, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff90) applyToGeo(g90, e.is_bot, e.country, e.region);
      if (ts >= cutoff30) applyToGeo(g30, e.is_bot, e.country, e.region);
      if (ts >= cutoff7) applyToGeo(g7, e.is_bot, e.country, e.region);
      if (ts >= cutoff90)
        applyToCity(ci90, e.is_bot, e.country, e.region, e.city, e.latitude, e.longitude);
      if (ts >= cutoff30)
        applyToCity(ci30, e.is_bot, e.country, e.region, e.city, e.latitude, e.longitude);
      if (ts >= cutoff7)
        applyToCity(ci7, e.is_bot, e.country, e.region, e.city, e.latitude, e.longitude);
    } else {
      // visit_linked feeds both unique-visitor counts AND the top of the
      // funnel; the rest of the funnel-relevant types feed only the funnel.
      if (e.type === "visit_linked" && e.visitor_id) {
        if (ts >= cutoff90) c90.visitorIds.add(e.visitor_id);
        if (ts >= cutoff30) c30.visitorIds.add(e.visitor_id);
        if (ts >= cutoff7) c7.visitorIds.add(e.visitor_id);
      }
      if (ts >= cutoff90) applyToFunnel(f90, e.type, e.payload, e.visitor_id);
      if (ts >= cutoff30) applyToFunnel(f30, e.type, e.payload, e.visitor_id);
      if (ts >= cutoff7) applyToFunnel(f7, e.type, e.payload, e.visitor_id);
      if (ts >= cutoff90)
        applyToLengthBins(b90, e.type, e.payload, e.visitor_id);
      if (ts >= cutoff30)
        applyToLengthBins(b30, e.type, e.payload, e.visitor_id);
      if (ts >= cutoff7)
        applyToLengthBins(b7, e.type, e.payload, e.visitor_id);
      if (e.type === "video_pause") {
        if (ts >= cutoff90) applyToPauseDropoff(p90, e.payload);
        if (ts >= cutoff30) applyToPauseDropoff(p30, e.payload);
        if (ts >= cutoff7) applyToPauseDropoff(p7, e.payload);
      }
    }
  }

  // ---- All-time totals ----
  const [
    { count: allVisitsCount },
    { count: allBotsCount },
    { count: allMobileCount },
    { count: allHumansCount },
    allTimeUnique,
    allTimeFunnelAndBins,
    allTimeSharedAndGeo,
  ] = await Promise.all([
    supabase
      .from("vlad_engagement_events")
      .select("id", { count: "exact", head: true })
      .eq("type", "visit"),
    supabase
      .from("vlad_engagement_events")
      .select("id", { count: "exact", head: true })
      .eq("type", "visit")
      .eq("is_bot", true),
    supabase
      .from("vlad_engagement_events")
      .select("id", { count: "exact", head: true })
      .eq("type", "visit")
      .eq("is_bot", false)
      .eq("device_type", "mobile"),
    supabase
      .from("vlad_engagement_events")
      .select("id", { count: "exact", head: true })
      .eq("type", "visit")
      .eq("is_bot", false),
    fetchAllTimeUniqueVisitors(),
    fetchAllTimeFunnelAndBins(),
    fetchAllTimeSharedAndGeo(),
  ]);

  const totalAll = allVisitsCount ?? 0;
  const humansAll = allHumansCount ?? 0;
  const allTime: EventCounts = {
    totalVisits: totalAll,
    uniqueVisitors: allTimeUnique,
    mobilePct: humansAll > 0 ? (allMobileCount ?? 0) / humansAll : null,
    botPct: totalAll > 0 ? (allBotsCount ?? 0) / totalAll : null,
  };

  const eventCounts = {
    last7d: counterToCounts(c7),
    last30d: counterToCounts(c30),
    last90d: counterToCounts(c90),
    allTime,
  };

  const funnel = {
    last7d: funnelToCounts(f7),
    last30d: funnelToCounts(f30),
    last90d: funnelToCounts(f90),
    allTime: funnelToCounts(allTimeFunnelAndBins.funnel),
  };

  const sharedBreakdown = {
    last7d: sharedToBreakdown(s7),
    last30d: sharedToBreakdown(s30),
    last90d: sharedToBreakdown(s90),
    allTime: sharedToBreakdown(allTimeSharedAndGeo.shared),
  };

  const geoVisits = {
    last7d: geoToOutput(g7),
    last30d: geoToOutput(g30),
    last90d: geoToOutput(g90),
    allTime: geoToOutput(allTimeSharedAndGeo.geo),
  };

  const cityVisits = {
    last7d: cityToOutput(ci7),
    last30d: cityToOutput(ci30),
    last90d: cityToOutput(ci90),
    allTime: cityToOutput(allTimeSharedAndGeo.city),
  };

  const lengthBinDropoff = {
    last7d: lengthBinsToArray(b7),
    last30d: lengthBinsToArray(b30),
    last90d: lengthBinsToArray(b90),
    allTime: lengthBinsToArray(allTimeFunnelAndBins.bins),
  };

  const pauseDropoff = {
    last7d: pauseDropoffToOutput(p7),
    last30d: pauseDropoffToOutput(p30),
    last90d: pauseDropoffToOutput(p90),
    allTime: pauseDropoffToOutput(allTimeFunnelAndBins.pauses),
  };

  const response: EngagementResponse = {
    seriesDays: SERIES_DAYS,
    visitsSeries,
    eventCounts,
    funnel,
    sharedBreakdown,
    lengthBinDropoff,
    pauseDropoff,
    geoVisits,
    cityVisits,
  };
  return NextResponse.json(response);
}
