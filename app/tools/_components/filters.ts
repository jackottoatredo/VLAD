// Shared types + helpers for the admin Include/Exclude chip filters used
// on /tools/usage and /tools/engagement.

import { PALETTE } from './chartTheme'

export type FilterChipKind = 'presenter' | 'product' | 'merchant' | 'region'

export type FilterChip = {
  kind: FilterChipKind
  // Canonical identifier the API filters on (e.g. "jack.otto@redo.com",
  // "Returns & Claims", "mammut.com", "California").
  value: string
  // Human-readable display string ("Jack Otto", etc).
  label: string
}

export type AdminFilters = {
  include: FilterChip[]
  exclude: FilterChip[]
}

export const EMPTY_FILTERS: AdminFilters = { include: [], exclude: [] }

// Per-kind list of options offered in the chip-input autocomplete. Both
// admin APIs return this shape (engagement adds regions; usage leaves
// regions empty since geo isn't tracked there).
export type FilterOption = { value: string; label: string }
export type FilterOptions = {
  presenters: FilterOption[]
  products: FilterOption[]
  merchants: FilterOption[]
  regions: FilterOption[]
}

export const EMPTY_FILTER_OPTIONS: FilterOptions = {
  presenters: [],
  products: [],
  merchants: [],
  regions: [],
}

export const KIND_LABELS: Record<FilterChipKind, string> = {
  presenter: 'Presenter',
  product: 'Product',
  merchant: 'Merchant',
  region: 'Region',
}

// Color tokens used for chip pills. Translucent fill so chips read as
// data not buttons; foreground is the accent so the kind is glanceable.
// Aligned with the dashboard chart palette.
export const KIND_COLORS: Record<FilterChipKind, { bg: string; fg: string }> = {
  presenter: { bg: 'rgba(249, 115, 22, 0.15)', fg: PALETTE.ORANGE },
  product: { bg: 'rgba(59, 130, 246, 0.15)', fg: PALETTE.BLUE },
  merchant: { bg: 'rgba(20, 184, 166, 0.15)', fg: PALETTE.TEAL },
  region: { bg: 'rgba(99, 102, 241, 0.15)', fg: PALETTE.INDIGO },
}

export function chipKey(c: FilterChip): string {
  return `${c.kind}:${c.value}`
}

export function hasChip(list: FilterChip[], chip: FilterChip): boolean {
  return list.some((c) => c.kind === chip.kind && c.value === chip.value)
}

export function removeChip(list: FilterChip[], chip: FilterChip): FilterChip[] {
  return list.filter((c) => !(c.kind === chip.kind && c.value === chip.value))
}

// Encode for URL query param. Returns null when both sides are empty so
// callers can omit the param entirely. JSON.stringify is round-trippable
// via JSON.parse on the server.
export function encodeFiltersForApi(f: AdminFilters): string | null {
  if (f.include.length === 0 && f.exclude.length === 0) return null
  return JSON.stringify(f)
}

// Decode and validate a query-param string. Returns EMPTY_FILTERS on any
// shape mismatch — never throws so callers can use it directly without
// try/catch. Server-side use.
export function decodeFiltersFromApi(raw: string | null): AdminFilters {
  if (!raw) return EMPTY_FILTERS
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return EMPTY_FILTERS
    const obj = parsed as { include?: unknown; exclude?: unknown }
    return {
      include: parseChipList(obj.include),
      exclude: parseChipList(obj.exclude),
    }
  } catch {
    return EMPTY_FILTERS
  }
}

const VALID_KINDS: ReadonlySet<FilterChipKind> = new Set([
  'presenter',
  'product',
  'merchant',
  'region',
])

// Slug metadata used by the API to evaluate slug-level filters
// (presenter / product / merchant). Sourced from a single vlad_renders
// query at the top of the request handler.
export type SlugMeta = {
  userId: string | null;
  productName: string | null;
  brandUrl: string | null;
};

// Visitor metadata used by the API to evaluate visitor-level filters
// (region). Sourced from a single vlad_engagement_visitors query at
// the top of the request handler.
export type VisitorMeta = {
  region: string | null;
  country: string | null;
  city: string | null;
  deviceType: string | null;
  uaFamily: string | null;
};

const SLUG_KIND_LIST: FilterChipKind[] = ["presenter", "product", "merchant"];

function chipsByKind(chips: FilterChip[], kind: FilterChipKind): FilterChip[] {
  return chips.filter((c) => c.kind === kind);
}

function matchSlugChip(meta: SlugMeta, chip: FilterChip): boolean {
  switch (chip.kind) {
    case "presenter":
      return meta.userId === chip.value;
    case "product":
      return meta.productName === chip.value;
    case "merchant":
      return meta.brandUrl === chip.value;
    case "region":
      // Region is per-event, not per-slug. Slug-level check is a no-op.
      return false;
  }
}

// Slug passes the include filter when, for every kind that has at
// least one include chip, at least one of those chips matches. Kinds
// with no include chips don't constrain. Region is excluded — it's a
// per-event dimension.
export function slugIncluded(
  meta: SlugMeta | undefined,
  includes: FilterChip[],
): boolean {
  if (includes.length === 0) return true;
  // Slugs we have no metadata for (deleted vlad_renders rows) can't
  // satisfy any include chip — drop them when filters are active.
  if (!meta) return false;
  for (const kind of SLUG_KIND_LIST) {
    const kindChips = chipsByKind(includes, kind);
    if (kindChips.length === 0) continue;
    if (!kindChips.some((c) => matchSlugChip(meta, c))) return false;
  }
  return true;
}

// Slug fails the exclude filter if ANY exclude chip (across kinds)
// matches.
export function slugExcluded(
  meta: SlugMeta | undefined,
  excludes: FilterChip[],
): boolean {
  if (excludes.length === 0 || !meta) return false;
  for (const chip of excludes) {
    if (chip.kind === "region") continue;
    if (matchSlugChip(meta, chip)) return true;
  }
  return false;
}

// Per-visitor region check. Region lives on the visitor row now, so
// the lookup happens by visitor_id. Events without a visitor_id
// (server-side bot `visit` rows) have no associated visitor; with an
// include-region chip they drop, otherwise they pass (exclude-region
// can't fire without a region to compare).
function regionAllowedForVisitor(
  visitorId: string | null,
  visitorMeta: Map<string, VisitorMeta>,
  includeRegions: FilterChip[],
  excludeRegions: FilterChip[],
): boolean {
  if (includeRegions.length === 0 && excludeRegions.length === 0) return true;
  const visitor = visitorId ? visitorMeta.get(visitorId) : undefined;
  const region = visitor?.region ?? null;
  if (includeRegions.length > 0) {
    if (!region) return false;
    if (!includeRegions.some((c) => c.value === region)) return false;
  }
  if (excludeRegions.length > 0 && region) {
    if (excludeRegions.some((c) => c.value === region)) return false;
  }
  return true;
}

// Convenience for callers: build a single closure that combines slug-
// and visitor-level checks. Pass the slug-meta and visitor-meta
// lookups the API has pre-fetched. The predicate is called per event
// row with `(slug, visitorId)` — region cascades to all of a visitor's
// events automatically.
export function makeEventAllowed(
  filters: AdminFilters,
  slugMeta: Map<string, SlugMeta>,
  visitorMeta: Map<string, VisitorMeta>,
): (slug: string, visitorId: string | null) => boolean {
  const includeRegions = chipsByKind(filters.include, "region");
  const excludeRegions = chipsByKind(filters.exclude, "region");
  const slugOnlyIncludes = filters.include.filter((c) => c.kind !== "region");
  const slugOnlyExcludes = filters.exclude.filter((c) => c.kind !== "region");
  const hasSlugFilters =
    slugOnlyIncludes.length > 0 || slugOnlyExcludes.length > 0;
  const hasRegionFilters =
    includeRegions.length > 0 || excludeRegions.length > 0;

  return (slug, visitorId) => {
    if (hasSlugFilters) {
      const meta = slug ? slugMeta.get(slug) : undefined;
      if (!slugIncluded(meta, slugOnlyIncludes)) return false;
      if (slugExcluded(meta, slugOnlyExcludes)) return false;
    }
    if (hasRegionFilters) {
      if (
        !regionAllowedForVisitor(
          visitorId,
          visitorMeta,
          includeRegions,
          excludeRegions,
        )
      ) {
        return false;
      }
    }
    return true;
  };
}

function parseChipList(raw: unknown): FilterChip[] {
  if (!Array.isArray(raw)) return []
  const out: FilterChip[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as { kind?: unknown; value?: unknown; label?: unknown }
    if (typeof c.kind !== 'string' || !VALID_KINDS.has(c.kind as FilterChipKind)) continue
    if (typeof c.value !== 'string' || c.value.length === 0) continue
    if (typeof c.label !== 'string') continue
    out.push({ kind: c.kind as FilterChipKind, value: c.value, label: c.label })
  }
  return out
}
