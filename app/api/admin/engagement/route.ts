import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { requireSession } from "@/lib/apiAuth";
import { MS_PER_DAY, dayKey, buildDateRange } from "@/lib/stats/dateRange";
import {
  decodeFiltersFromApi,
  makeEventAllowed,
  type FilterOptions,
  type SlugMeta,
  type VisitorMeta,
} from "@/app/admin/_components/filters";

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
// download route still count when the redirect carried ?v=). The four
// CTA outcomes are tracked separately so the funnel reveals which CTA
// each engaged viewer chose, not just "an action happened".
export type FunnelCounts = {
  visit_linked: number;
  video_play: number;
  q25: number;
  q50: number;
  q75: number;
  video_end: number;
  click_copy_link: number;
  click_download: number;
  click_interactive_demo: number;
  click_book_demo: number;
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

// Top-shares leaderboard row. visits = count of `visit` rows for this
// slug; uniqueVisitors / plays / videoEnds are distinct viewer counts.
// The four CTA fields are raw counts (multiple clicks from the same
// person each count) — the question is "how many actions of each
// kind", which lets the leaderboard surface what works on each share.
// presenter resolves vlad_renders.user_id → vlad_users for display;
// null when the share's owner has been deleted.
export type TopSharePresenter = {
  email: string;
  firstName: string;
  lastName: string;
};

export type TopShareEntry = {
  slug: string;
  presenter: TopSharePresenter | null;
  visits: number;
  uniqueVisitors: number;
  plays: number;
  videoEnds: number;
  copyLinkClicks: number;
  downloadClicks: number;
  interactiveClicks: number;
  bookDemoClicks: number;
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
  topShares: {
    last7d: TopShareEntry[];
    last30d: TopShareEntry[];
    last90d: TopShareEntry[];
    allTime: TopShareEntry[];
  };
  // Available chips for the dashboard filters modal — autocomplete data
  // for presenter / product / merchant / region.
  filterOptions: FilterOptions;
};

type EventRow = {
  type: string;
  slug: string;
  created_at: string;
  is_bot: boolean;
  bot_kind: string | null;
  visitor_id: string | null;
  ip_hash: string;
  referrer_kind: string | null;
  payload: Record<string, unknown> | null;
};

// Pulled from vlad_engagement_visitors at the top of every request.
// Visitor profile carries stable per-visitor attributes (geo, UA,
// device); event-level aggregations JOIN through visitor_id when they
// need any of these.
type VisitorRow = {
  visitor_id: string;
  ip_hash: string;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  ua_family: string | null;
  device_type: string | null;
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
// reached this stage at least once in the window." A single viewer can
// land in multiple click_* sets if they hit more than one CTA.
type FunnelSets = {
  visit_linked: Set<string>;
  video_play: Set<string>;
  q25: Set<string>;
  q50: Set<string>;
  q75: Set<string>;
  video_end: Set<string>;
  click_copy_link: Set<string>;
  click_download: Set<string>;
  click_interactive_demo: Set<string>;
  click_book_demo: Set<string>;
};

function makeFunnel(): FunnelSets {
  return {
    visit_linked: new Set(),
    video_play: new Set(),
    q25: new Set(),
    q50: new Set(),
    q75: new Set(),
    video_end: new Set(),
    click_copy_link: new Set(),
    click_download: new Set(),
    click_interactive_demo: new Set(),
    click_book_demo: new Set(),
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
      f.click_copy_link.add(visitorId);
      return;
    case "asset_download":
      f.click_download.add(visitorId);
      return;
    case "click_interactive_demo":
      f.click_interactive_demo.add(visitorId);
      return;
    case "click_book_demo":
      f.click_book_demo.add(visitorId);
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
    click_copy_link: f.click_copy_link.size,
    click_download: f.click_download.size,
    click_interactive_demo: f.click_interactive_demo.size,
    click_book_demo: f.click_book_demo.size,
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

// Visitor-driven country/region aggregation. Per-visitor rather than
// per-event so a single visitor with N events doesn't inflate their
// country's count. (Per-visit-event semantics is also viable; see
// the call sites for which one we pass.)
function applyToGeo(acc: GeoAcc, visitor: VisitorRow | undefined): void {
  if (!visitor || !visitor.country) return;
  let entry = acc.get(visitor.country);
  if (!entry) {
    entry = { count: 0, regions: new Map() };
    acc.set(visitor.country, entry);
  }
  entry.count++;
  if (visitor.region) {
    entry.regions.set(
      visitor.region,
      (entry.regions.get(visitor.region) ?? 0) + 1,
    );
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

// Visitor-driven city aggregation. Geo and device come from the
// visitor row; events that can't be joined to a visitor (bot `visit`
// rows) are skipped entirely.
function applyToCity(acc: CityAcc, visitor: VisitorRow | undefined): void {
  if (!visitor) return;
  // Desktop-only: cellular NAT routes mobile traffic through carrier
  // gateway IPs (most US cell traffic egresses through Ashburn, VA),
  // so the lat/lng we get for mobile visits points at the gateway, not
  // the user. Dropping mobile rows here keeps the dot maps honest.
  if (visitor.device_type !== "desktop") return;
  const { country, region, city, latitude, longitude } = visitor;
  if (!country || !city || latitude == null || longitude == null) return;
  const key = `${country}|${region ?? ""}|${city}`;
  const entry = acc.get(key);
  if (entry) {
    entry.count++;
  } else {
    acc.set(key, {
      country,
      region,
      city,
      lat: latitude,
      lng: longitude,
      count: 1,
    });
  }
}

function cityToOutput(acc: CityAcc): CityVisitsEntry[] {
  return [...acc.values()].sort((a, b) => b.count - a.count);
}

// Top-shares accumulator: per-slug stats keyed by slug. Visit count is
// raw row count; viewer-derived metrics (uniqueVisitors / plays / q75)
// are Sets of visitor_ids so replays don't inflate. The four CTA
// counters are raw counts (multiple clicks per person each count).
type TopSharesEntry = {
  visits: number;
  visitorIds: Set<string>;
  plays: Set<string>;
  videoEnds: Set<string>;
  copyLinkCount: number;
  downloadCount: number;
  interactiveCount: number;
  bookDemoCount: number;
};

type TopSharesAcc = Map<string, TopSharesEntry>;

function makeTopShares(): TopSharesAcc {
  return new Map();
}

function emptyTopSharesEntry(): TopSharesEntry {
  return {
    visits: 0,
    visitorIds: new Set(),
    plays: new Set(),
    videoEnds: new Set(),
    copyLinkCount: 0,
    downloadCount: 0,
    interactiveCount: 0,
    bookDemoCount: 0,
  };
}

function getOrCreateTopShares(acc: TopSharesAcc, slug: string): TopSharesEntry {
  let entry = acc.get(slug);
  if (!entry) {
    entry = emptyTopSharesEntry();
    acc.set(slug, entry);
  }
  return entry;
}

function applyVisitToTopShares(acc: TopSharesAcc, slug: string): void {
  if (!slug) return;
  getOrCreateTopShares(acc, slug).visits++;
}

function applyEventToTopShares(
  acc: TopSharesAcc,
  type: string,
  slug: string,
  visitorId: string | null,
): void {
  if (!slug) return;
  switch (type) {
    case "visit_linked":
      if (visitorId) getOrCreateTopShares(acc, slug).visitorIds.add(visitorId);
      return;
    case "video_play":
      if (visitorId) getOrCreateTopShares(acc, slug).plays.add(visitorId);
      return;
    case "video_end":
      if (visitorId) getOrCreateTopShares(acc, slug).videoEnds.add(visitorId);
      return;
    case "click_copy_link":
      getOrCreateTopShares(acc, slug).copyLinkCount++;
      return;
    case "asset_download":
      getOrCreateTopShares(acc, slug).downloadCount++;
      return;
    case "click_interactive_demo":
      getOrCreateTopShares(acc, slug).interactiveCount++;
      return;
    case "click_book_demo":
      getOrCreateTopShares(acc, slug).bookDemoCount++;
      return;
  }
}

// All-time distinct visitor count via paginated fetch — Supabase JS
// can't compute COUNT(DISTINCT) directly without an RPC. At v1 volume
// this is a few KB; revisit with an RPC if the table grows past ~100k
// visit_linked rows.
async function fetchAllTimeUniqueVisitors(
  eventAllowed: (slug: string, visitorId: string | null) => boolean,
): Promise<number> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("vlad_engagement_events")
      .select("slug, visitor_id")
      .eq("type", "visit_linked")
      .not("visitor_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as { slug: string; visitor_id: string }[]) {
      if (!eventAllowed(r.slug, r.visitor_id)) continue;
      if (typeof r.visitor_id === "string") ids.add(r.visitor_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return ids.size;
}

// All-time shared-breakdown + top-shares-visits + visit counters built
// by paginating every visit/visit_linked row. Bot visits come through
// `visit`; humans through `visit_linked`. Geo + city are built later
// from the union of `geoSeen` collected here AND in
// fetchAllTimeFunnelAndBins so we capture every visitor that has any
// event, not just visit_linked rows (a dropped beacon shouldn't drop
// the visitor from the map).
async function fetchAllTimeSharedAndGeo(
  topShares: TopSharesAcc,
  eventAllowed: (slug: string, visitorId: string | null) => boolean,
  visitorRows: Map<string, VisitorRow>,
  geoSeen: Set<string>,
): Promise<{
  shared: SharedAccumulator;
  visitCounter: { visits: number; bots: number; humans: number; mobile: number };
}> {
  const s = makeShared();
  const visitCounter = { visits: 0, bots: 0, humans: 0, mobile: 0 };
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("vlad_engagement_events")
      .select(
        "type, slug, is_bot, bot_kind, visitor_id, referrer_kind, ip_hash",
      )
      .in("type", ["visit", "visit_linked"])
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as {
      type: string;
      slug: string;
      is_bot: boolean;
      bot_kind: string | null;
      visitor_id: string | null;
      referrer_kind: string | null;
      ip_hash: string;
    }[]) {
      if (!eventAllowed(r.slug, r.visitor_id)) continue;
      visitCounter.visits++;
      applyVisitToTopShares(topShares, r.slug);
      if (r.type === "visit") {
        // Server-side bot visit — no visitor row, no geo, never counted
        // as human. Feeds unfurl-bot donut and bot %.
        visitCounter.bots++;
        applyToShared(s, true, r.bot_kind, r.referrer_kind, r.ip_hash);
      } else {
        // visit_linked — human page-load.
        visitCounter.humans++;
        if (r.visitor_id) {
          const visitor = visitorRows.get(r.visitor_id);
          if (visitor?.device_type === "mobile") visitCounter.mobile++;
          if (visitor) geoSeen.add(r.visitor_id);
        }
        applyToShared(s, false, null, r.referrer_kind, r.ip_hash);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { shared: s, visitCounter };
}

// All-time funnel + length-bin drop-off + pause hotspots built by
// paginating every engagement-detail row. Three accumulators filled in
// the same pass to avoid duplicate queries. visitor_id filter dropped
// because pauses count regardless of whether localStorage resolved —
// funnel/length-bin functions still gate on visitor_id internally.
async function fetchAllTimeFunnelAndBins(
  topShares: TopSharesAcc,
  eventAllowed: (slug: string, visitorId: string | null) => boolean,
  visitorRows: Map<string, VisitorRow>,
  geoSeen: Set<string>,
): Promise<{
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
      .select("type, slug, payload, visitor_id")
      .in("type", FUNNEL_TYPES as unknown as string[])
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as {
      type: string;
      slug: string;
      payload: Record<string, unknown> | null;
      visitor_id: string | null;
    }[]) {
      if (!eventAllowed(r.slug, r.visitor_id)) continue;
      applyToFunnel(f, r.type, r.payload, r.visitor_id);
      applyToLengthBins(bins, r.type, r.payload, r.visitor_id);
      if (r.type === "video_pause") applyToPauseDropoff(pauses, r.payload);
      applyEventToTopShares(topShares, r.type, r.slug, r.visitor_id);
      // Visitor showed up under this slug filter — record so the geo/city
      // map gets a tick even if their visit_linked never landed.
      if (r.visitor_id && visitorRows.has(r.visitor_id)) {
        geoSeen.add(r.visitor_id);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { funnel: f, bins, pauses };
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Filters from the shared modal. Decoded once and threaded through
  // every aggregation so the dashboard reflects the active filters end
  // to end. Slug-level filters (presenter / product / merchant) require
  // joining engagement events to vlad_renders; we pre-fetch a single
  // slug→meta map up front so the per-event check is O(1).
  const { searchParams } = new URL(request.url);
  const filters = decodeFiltersFromApi(searchParams.get("filters"));

  const since = new Date(Date.now() - SERIES_DAYS * MS_PER_DAY).toISOString();

  // Slug → metadata for slug-level filters. Visitor → metadata for
  // visitor-level filters (region) and per-event geo/device joins.
  // All three fetched in parallel — none depends on the others. The
  // slug map is reused later for the topShares presenter join, saving
  // a duplicate query.
  const [eventsResult, slugMetaResult, visitorsResult] = await Promise.all([
    supabase
      .from("vlad_engagement_events")
      .select(
        "type, slug, created_at, is_bot, bot_kind, visitor_id, ip_hash, referrer_kind, payload",
      )
      .in("type", ["visit", ...FUNNEL_TYPES])
      .gte("created_at", since)
      .order("created_at", { ascending: true }),
    supabase
      .from("vlad_renders")
      .select("slug, user_id, product_name, brand_url")
      .not("slug", "is", null),
    supabase
      .from("vlad_engagement_visitors")
      .select(
        "visitor_id, ip_hash, country, region, city, latitude, longitude, ua_family, device_type",
      ),
  ]);

  const { data, error } = eventsResult;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const events = (data ?? []) as EventRow[];

  type RenderMetaRow = {
    slug: string | null;
    user_id: string | null;
    product_name: string | null;
    brand_url: string | null;
  };
  const slugMeta = new Map<string, SlugMeta>();
  for (const r of (slugMetaResult.data ?? []) as RenderMetaRow[]) {
    if (!r.slug) continue;
    slugMeta.set(r.slug, {
      userId: r.user_id,
      productName: r.product_name,
      brandUrl: r.brand_url,
    });
  }
  // visitorRows keeps the full row (geo + lat/lng) for aggregations.
  // visitorMeta is the slim shape passed to the filter predicate.
  const visitorRows = new Map<string, VisitorRow>();
  const visitorMeta = new Map<string, VisitorMeta>();
  for (const v of (visitorsResult.data ?? []) as VisitorRow[]) {
    if (!v.visitor_id) continue;
    visitorRows.set(v.visitor_id, v);
    visitorMeta.set(v.visitor_id, {
      region: v.region,
      country: v.country,
      city: v.city,
      deviceType: v.device_type,
      uaFamily: v.ua_family,
    });
  }
  const eventAllowed = makeEventAllowed(filters, slugMeta, visitorMeta);

  // ---- Visits series (per-day stack) ----
  // Bots come through `visit` (server-side, UA-gated). Humans come
  // through `visit_linked` (client beacon w/ visitor_id); device split
  // resolves via the visitor row.
  const range = buildDateRange(SERIES_DAYS);
  const buckets = new Map<string, VisitsPoint>();
  for (const d of range) {
    buckets.set(d, { date: d, bot: 0, desktop: 0, mobile: 0, tablet: 0, other: 0 });
  }
  for (const e of events) {
    if (e.type !== "visit" && e.type !== "visit_linked") continue;
    if (!eventAllowed(e.slug, e.visitor_id)) continue;
    const point = buckets.get(dayKey(e.created_at));
    if (!point) continue;
    if (e.type === "visit") {
      point.bot++;
      continue;
    }
    const visitor = e.visitor_id ? visitorRows.get(e.visitor_id) : undefined;
    switch (visitor?.device_type) {
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
  const ts7 = makeTopShares();
  const ts30 = makeTopShares();
  const ts90 = makeTopShares();
  const tsAll = makeTopShares();
  const b7 = makeLengthBins();
  const b30 = makeLengthBins();
  const b90 = makeLengthBins();
  const p7 = makePauseDropoff();
  const p30 = makePauseDropoff();
  const p90 = makePauseDropoff();

  // Dedup sets for geo/city aggregation. We want one count per unique
  // visitor per window — not per-event — so a visitor with many events
  // in the window contributes once, and a visitor with only CTA events
  // (no visit_linked, e.g. a dropped beacon) still appears on the map.
  const geoSeen7 = new Set<string>();
  const geoSeen30 = new Set<string>();
  const geoSeen90 = new Set<string>();

  for (const e of events) {
    const ts = new Date(e.created_at).getTime();
    // Filter once per event before any aggregation. Region cascades
    // through visitor_id, so the predicate is uniform across event types.
    if (!eventAllowed(e.slug, e.visitor_id)) continue;

    if (e.type === "visit") {
      // Bot visit (server-side emit, UA-gated). No visitor row, no geo.
      const apply = (c: Counter) => {
        c.visits++;
        c.bots++;
      };
      if (ts >= cutoff90) apply(c90);
      if (ts >= cutoff30) apply(c30);
      if (ts >= cutoff7) apply(c7);
      if (ts >= cutoff90)
        applyToShared(s90, true, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff30)
        applyToShared(s30, true, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff7)
        applyToShared(s7, true, e.bot_kind, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff90) applyVisitToTopShares(ts90, e.slug);
      if (ts >= cutoff30) applyVisitToTopShares(ts30, e.slug);
      if (ts >= cutoff7) applyVisitToTopShares(ts7, e.slug);
      continue;
    }

    // Non-visit event. visit_linked carries the human page-load
    // semantics; other engagement events feed funnel/length/pause.
    const visitor = e.visitor_id ? visitorRows.get(e.visitor_id) : undefined;

    // Geo + city: dedup by visitor per window so any event from a
    // visitor pulls them onto the map once. Robust to dropped
    // visit_linked beacons (visitor still has CTA events).
    if (e.visitor_id && visitor) {
      if (ts >= cutoff90 && !geoSeen90.has(e.visitor_id)) {
        geoSeen90.add(e.visitor_id);
        applyToGeo(g90, visitor);
        applyToCity(ci90, visitor);
      }
      if (ts >= cutoff30 && !geoSeen30.has(e.visitor_id)) {
        geoSeen30.add(e.visitor_id);
        applyToGeo(g30, visitor);
        applyToCity(ci30, visitor);
      }
      if (ts >= cutoff7 && !geoSeen7.has(e.visitor_id)) {
        geoSeen7.add(e.visitor_id);
        applyToGeo(g7, visitor);
        applyToCity(ci7, visitor);
      }
    }

    if (e.type === "visit_linked") {
      const isMobile = visitor?.device_type === "mobile";
      const apply = (c: Counter) => {
        c.visits++;
        c.humans++;
        if (isMobile) c.mobile++;
        if (e.visitor_id) c.visitorIds.add(e.visitor_id);
      };
      if (ts >= cutoff90) apply(c90);
      if (ts >= cutoff30) apply(c30);
      if (ts >= cutoff7) apply(c7);
      if (ts >= cutoff90)
        applyToShared(s90, false, null, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff30)
        applyToShared(s30, false, null, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff7)
        applyToShared(s7, false, null, e.referrer_kind, e.ip_hash);
      if (ts >= cutoff90) applyVisitToTopShares(ts90, e.slug);
      if (ts >= cutoff30) applyVisitToTopShares(ts30, e.slug);
      if (ts >= cutoff7) applyVisitToTopShares(ts7, e.slug);
    }

    if (ts >= cutoff90) applyToFunnel(f90, e.type, e.payload, e.visitor_id);
    if (ts >= cutoff30) applyToFunnel(f30, e.type, e.payload, e.visitor_id);
    if (ts >= cutoff7) applyToFunnel(f7, e.type, e.payload, e.visitor_id);
    if (ts >= cutoff90)
      applyEventToTopShares(ts90, e.type, e.slug, e.visitor_id);
    if (ts >= cutoff30)
      applyEventToTopShares(ts30, e.type, e.slug, e.visitor_id);
    if (ts >= cutoff7)
      applyEventToTopShares(ts7, e.type, e.slug, e.visitor_id);
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

  // ---- All-time totals ----
  // Visit-row counters are derived during the SharedAndGeo pagination
  // (see allTimeSharedAndGeo.visitCounter) so the same filter predicate
  // applies. Saved 4 separate SQL count() queries that couldn't honor
  // the predicate anyway.
  // Shared dedup set populated by both all-time paginators. Every
  // visitor with any allowed event lands here; geo/city are then
  // derived once at the end so the dot map matches "visitors known to
  // the system" rather than "visitors with a visit_linked row".
  const allTimeGeoSeen = new Set<string>();
  const [allTimeUnique, allTimeFunnelAndBins, allTimeSharedAndGeo] =
    await Promise.all([
      fetchAllTimeUniqueVisitors(eventAllowed),
      fetchAllTimeFunnelAndBins(tsAll, eventAllowed, visitorRows, allTimeGeoSeen),
      fetchAllTimeSharedAndGeo(tsAll, eventAllowed, visitorRows, allTimeGeoSeen),
    ]);

  const allTimeGeo = makeGeo();
  const allTimeCity = makeCity();
  for (const id of allTimeGeoSeen) {
    const v = visitorRows.get(id);
    if (!v) continue;
    applyToGeo(allTimeGeo, v);
    applyToCity(allTimeCity, v);
  }

  const vc = allTimeSharedAndGeo.visitCounter;
  const allTime: EventCounts = {
    totalVisits: vc.visits,
    uniqueVisitors: allTimeUnique,
    mobilePct: vc.humans > 0 ? vc.mobile / vc.humans : null,
    botPct: vc.visits > 0 ? vc.bots / vc.visits : null,
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
    allTime: geoToOutput(allTimeGeo),
  };

  const cityVisits = {
    last7d: cityToOutput(ci7),
    last30d: cityToOutput(ci30),
    last90d: cityToOutput(ci90),
    allTime: cityToOutput(allTimeCity),
  };

  // Resolve presenter (the user who created the share) per slug. The
  // slug→user_id mapping already lives in `slugMeta` from the top-of-
  // request fetch; we just need vlad_users for display names.
  const presenterBySlug = new Map<string, TopSharePresenter>();
  const presenterUserIds = new Set<string>();
  for (const acc of [ts7, ts30, ts90, tsAll]) {
    for (const slug of acc.keys()) {
      const meta = slugMeta.get(slug);
      if (meta?.userId) presenterUserIds.add(meta.userId);
    }
  }
  if (presenterUserIds.size > 0) {
    type UserRow = { id: string; first_name: string; last_name: string };
    const { data: userRows } = await supabase
      .from("vlad_users")
      .select("id, first_name, last_name")
      .in("id", [...presenterUserIds]);
    const userMap = new Map<string, TopSharePresenter>();
    for (const u of (userRows ?? []) as UserRow[]) {
      userMap.set(u.id, {
        email: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
      });
    }
    for (const [slug, meta] of slugMeta) {
      if (!meta.userId) continue;
      const p = userMap.get(meta.userId);
      if (p) presenterBySlug.set(slug, p);
    }
  }

  function topSharesToOutput(acc: TopSharesAcc): TopShareEntry[] {
    return [...acc.entries()]
      .map(([slug, e]) => ({
        slug,
        presenter: presenterBySlug.get(slug) ?? null,
        visits: e.visits,
        uniqueVisitors: e.visitorIds.size,
        plays: e.plays.size,
        videoEnds: e.videoEnds.size,
        copyLinkClicks: e.copyLinkCount,
        downloadClicks: e.downloadCount,
        interactiveClicks: e.interactiveCount,
        bookDemoClicks: e.bookDemoCount,
      }))
      .sort((a, b) => b.visits - a.visits);
  }

  const topShares = {
    last7d: topSharesToOutput(ts7),
    last30d: topSharesToOutput(ts30),
    last90d: topSharesToOutput(ts90),
    allTime: topSharesToOutput(tsAll),
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

  // ---- Filter options for the dashboard filters modal ----
  // Parallel reads for the four chip-input data sources. All small —
  // each is a metadata query, not an event scan.
  const [
    { data: presenterRows },
    { data: productRows },
    { data: merchantRows },
    { data: regionRows },
  ] = await Promise.all([
    supabase
      .from("vlad_users")
      .select("id, first_name, last_name"),
    supabase
      .from("vlad_renders")
      .select("product_name")
      .not("product_name", "is", null),
    supabase
      .from("vlad_renders")
      .select("brand, brand_name, brand_url")
      .not("brand_url", "is", null),
    supabase
      .from("vlad_engagement_visitors")
      .select("region")
      .not("region", "is", null),
  ]);

  const presenterOptions = ((presenterRows ?? []) as {
    id: string;
    first_name: string;
    last_name: string;
  }[])
    .map((u) => ({
      value: u.id,
      label: `${u.first_name} ${u.last_name}`.trim() || u.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const productSet = new Set<string>();
  for (const r of (productRows ?? []) as { product_name: string | null }[]) {
    if (r.product_name) productSet.add(r.product_name);
  }
  const productOptions = [...productSet]
    .map((name) => ({ value: name, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const merchantMap = new Map<string, string>();
  for (const r of (merchantRows ?? []) as {
    brand: string | null;
    brand_name: string | null;
    brand_url: string | null;
  }[]) {
    const value = r.brand_url ?? r.brand ?? null;
    if (!value) continue;
    const label = r.brand_name?.trim() || r.brand || value;
    if (!merchantMap.has(value)) merchantMap.set(value, label);
  }
  const merchantOptions = [...merchantMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const regionSet = new Set<string>();
  for (const r of (regionRows ?? []) as { region: string | null }[]) {
    if (r.region) regionSet.add(r.region);
  }
  const regionOptions = [...regionSet]
    .map((name) => ({ value: name, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filterOptions: FilterOptions = {
    presenters: presenterOptions,
    products: productOptions,
    merchants: merchantOptions,
    regions: regionOptions,
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
    topShares,
    filterOptions,
  };
  return NextResponse.json(response);
}
