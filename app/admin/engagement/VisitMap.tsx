'use client'

import { useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import { geoAlbersUsa, geoEqualEarth, geoPath } from 'd3-geo'
import type { FeatureCollection, Feature, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import worldTopology from 'world-atlas/countries-110m.json'
import usaTopology from 'us-atlas/states-10m.json'
import type {
  CityVisitsEntry,
  GeoVisitsEntry,
} from '@/app/api/admin/engagement/route'
import { numericToAlpha2 } from '@/lib/stats/iso3166'
import { PALETTE } from '@/app/admin/_components/chartTheme'

// Pre-compute the GeoJSON FeatureCollections once at module load.
// world-atlas / us-atlas data is ~100-150KB each and never changes;
// parsing on every render would be wasteful. Casts are necessary
// because topojson-client typings are loose around feature() return.
const COUNTRIES_FC = feature(
  worldTopology as unknown as Topology<{ countries: GeometryCollection }>,
  (worldTopology as unknown as Topology<{ countries: GeometryCollection }>).objects.countries,
) as unknown as FeatureCollection

const US_STATES_FC = feature(
  usaTopology as unknown as Topology<{ states: GeometryCollection }>,
  (usaTopology as unknown as Topology<{ states: GeometryCollection }>).objects.states,
) as unknown as FeatureCollection

// Fixed viewBoxes; SVGs scale responsively via width=100%.
// Aspect ratios chosen so the projection fills without letterboxing.
const WORLD_VIEW_W = 800
const WORLD_VIEW_H = 380
const US_VIEW_W = 800
const US_VIEW_H = 500

// Display strings for ISO 3166-1 alpha-2 codes. Avoids pulling in a
// full country-name lib for the handful that matter most; unknown codes
// fall through to the alpha-2 itself.
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  GB: 'United Kingdom',
  IE: 'Ireland',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  PL: 'Poland',
  PT: 'Portugal',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
  CN: 'China',
  IN: 'India',
  SG: 'Singapore',
  KR: 'South Korea',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  ZA: 'South Africa',
  IL: 'Israel',
  AE: 'United Arab Emirates',
  TR: 'Turkey',
  RU: 'Russia',
}

function countryDisplayName(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}

type WorldTooltip = {
  countryName: string
  count: number
  regions: { region: string; count: number }[]
  // Position relative to the wrapping container.
  x: number
  y: number
}

export function WorldVisitMap({ entries }: { entries: GeoVisitsEntry[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<WorldTooltip | null>(null)

  // alpha-2 → entry lookup; built once per render from the API payload.
  const byCountry = useMemo(() => {
    const m = new Map<string, GeoVisitsEntry>()
    for (const e of entries) m.set(e.country, e)
    return m
  }, [entries])

  const maxCount = useMemo(
    () => entries.reduce((max, e) => (e.count > max ? e.count : max), 0),
    [entries],
  )

  // d3-geo path/projection — re-derived if the viewport changes (it
  // doesn't here since we use a fixed viewBox, but cheap enough).
  const path = useMemo(() => {
    const projection = geoEqualEarth().fitSize(
      [WORLD_VIEW_W, WORLD_VIEW_H],
      COUNTRIES_FC,
    )
    return geoPath(projection)
  }, [])

  // Color: opacity-scaled orange. 0 visits → surface tint;
  // max visits → opaque orange. Floor at 0.18 so any visited country
  // is visible against the background.
  function fillFor(country: string | null): string {
    if (!country) return 'var(--surface)'
    const entry = byCountry.get(country)
    if (!entry || maxCount === 0) return 'var(--surface)'
    const ratio = entry.count / maxCount
    const alpha = 0.18 + 0.82 * ratio
    return `rgba(249, 115, 22, ${alpha.toFixed(3)})`
  }

  function handleEnter(geo: Feature<Geometry>, evt: React.MouseEvent) {
    const numericId = String(geo.id ?? '')
    const alpha2 = numericToAlpha2(numericId)
    const entry = alpha2 ? byCountry.get(alpha2) : null
    if (!entry) return
    const rect = containerRef.current?.getBoundingClientRect()
    setTooltip({
      countryName: countryDisplayName(entry.country),
      count: entry.count,
      regions: entry.regions,
      x: evt.clientX - (rect?.left ?? 0),
      y: evt.clientY - (rect?.top ?? 0),
    })
  }

  function handleMove(evt: React.MouseEvent) {
    if (!tooltip) return
    const rect = containerRef.current?.getBoundingClientRect()
    setTooltip({
      ...tooltip,
      x: evt.clientX - (rect?.left ?? 0),
      y: evt.clientY - (rect?.top ?? 0),
    })
  }

  function handleLeave() {
    setTooltip(null)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${WORLD_VIEW_W} ${WORLD_VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="World map of human visits by country"
      >
        {COUNTRIES_FC.features.map((geo) => {
          const numericId = String(geo.id ?? '')
          const alpha2 = numericToAlpha2(numericId)
          return (
            <path
              key={numericId}
              d={path(geo) ?? undefined}
              fill={fillFor(alpha2)}
              stroke="var(--border)"
              strokeWidth={0.4}
              onMouseEnter={(e) => handleEnter(geo, e)}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              style={{ transition: 'fill 80ms' }}
            />
          )
        })}
      </svg>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 min-w-[10rem] rounded-md border border-border bg-surface p-2 text-xs shadow-lg"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            // Avoid overflow off the right edge for countries hovered near it.
            maxWidth: 220,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-foreground">{tooltip.countryName}</span>
            <span
              className="tabular-nums text-foreground"
              style={{ color: PALETTE.ORANGE }}
            >
              {tooltip.count}
            </span>
          </div>
          {tooltip.regions.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {tooltip.regions.map((r) => (
                <li
                  key={r.region}
                  className="flex items-center justify-between gap-3 text-muted"
                >
                  <span className="truncate">{r.region}</span>
                  <span className="tabular-nums text-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// US visit map — state outlines + city dots aggregated by city
// =============================================================================

type CityTooltip = {
  city: string
  region: string | null
  count: number
  x: number
  y: number
}

// Visual scaling for city dots: sqrt(count) keeps perceptual area
// roughly proportional to count without letting outliers dominate.
// Capped so a single huge city can't visually crowd out the rest.
const DOT_RADIUS_MIN = 4
const DOT_RADIUS_MAX = 28
function dotRadius(count: number): number {
  const r = DOT_RADIUS_MIN + Math.sqrt(count) * 4
  return Math.min(r, DOT_RADIUS_MAX)
}

export function UsVisitMap({ cities }: { cities: CityVisitsEntry[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<CityTooltip | null>(null)

  // Split cities into US (rendered as dots) and international (shown as
  // a "+ N visits" badge in the corner since geoAlbersUsa drops them).
  const { usCities, internationalCount } = useMemo(() => {
    const us: CityVisitsEntry[] = []
    let intl = 0
    for (const c of cities) {
      if (c.country === 'US') us.push(c)
      else intl += c.count
    }
    return { usCities: us, internationalCount: intl }
  }, [cities])

  // Single projection used for both state polygons and city points so
  // the dots line up with the underlying map (Alaska/Hawaii inset etc).
  const projection = useMemo(
    () => geoAlbersUsa().fitSize([US_VIEW_W, US_VIEW_H], US_STATES_FC),
    [],
  )
  const path = useMemo(() => geoPath(projection), [projection])

  // Project each city once. Filter nulls (geoAlbersUsa returns null for
  // anything outside the US, including Puerto Rico depending on data).
  const projectedCities = useMemo(() => {
    return usCities
      .map((c) => {
        const xy = projection([c.lng, c.lat])
        if (!xy) return null
        return { city: c, x: xy[0], y: xy[1] }
      })
      .filter((v): v is { city: CityVisitsEntry; x: number; y: number } => v != null)
      // Render larger dots first so smaller ones sit on top — easier to
      // hover the small dots clustered next to a giant.
      .sort((a, b) => b.city.count - a.city.count)
  }, [usCities, projection])

  function handleEnter(c: CityVisitsEntry, evt: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    setTooltip({
      city: c.city,
      region: c.region,
      count: c.count,
      x: evt.clientX - (rect?.left ?? 0),
      y: evt.clientY - (rect?.top ?? 0),
    })
  }
  function handleMove(evt: React.MouseEvent) {
    if (!tooltip) return
    const rect = containerRef.current?.getBoundingClientRect()
    setTooltip({
      ...tooltip,
      x: evt.clientX - (rect?.left ?? 0),
      y: evt.clientY - (rect?.top ?? 0),
    })
  }
  function handleLeave() {
    setTooltip(null)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${US_VIEW_W} ${US_VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="US map of human visits by city"
      >
        {/* State polygons — neutral fill, just for geographic context. */}
        {US_STATES_FC.features.map((s) => (
          <path
            key={String(s.id)}
            d={path(s) ?? undefined}
            fill="var(--surface)"
            stroke="var(--border)"
            strokeWidth={0.5}
          />
        ))}
        {/* City dots — single fill color with alpha, radius ∝ √count.
            Pointer events on the circle drive the tooltip. */}
        {projectedCities.map(({ city, x, y }) => (
          <circle
            key={`${city.region ?? ''}|${city.city}`}
            cx={x}
            cy={y}
            r={dotRadius(city.count)}
            fill={PALETTE.ORANGE}
            fillOpacity={0.55}
            stroke={PALETTE.ORANGE}
            strokeWidth={1}
            onMouseEnter={(e) => handleEnter(city, e)}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            style={{ cursor: 'crosshair' }}
          />
        ))}
      </svg>
      {internationalCount > 0 && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-border bg-surface/85 px-2 py-1 text-xs text-muted">
          + {internationalCount.toLocaleString()} international{' '}
          {internationalCount === 1 ? 'visit' : 'visits'}
        </div>
      )}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 min-w-[10rem] rounded-md border border-border bg-surface p-2 text-xs shadow-lg"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            maxWidth: 240,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-foreground">
              {tooltip.city}
              {tooltip.region ? `, ${tooltip.region}` : ''}
            </span>
            <span className="tabular-nums" style={{ color: PALETTE.ORANGE }}>
              {tooltip.count}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
