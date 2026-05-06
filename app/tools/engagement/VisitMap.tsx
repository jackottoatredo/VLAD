'use client'

import { useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import { geoAlbersUsa, geoEqualEarth, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import worldTopology from 'world-atlas/countries-110m.json'
import usaTopology from 'us-atlas/states-10m.json'
import type { CityVisitsEntry } from '@/app/api/tools/engagement/route'
import { PALETTE } from '@/app/tools/_components/chartTheme'

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

type CityTooltip = {
  city: string
  region: string | null
  // Displayed only when present — UsVisitMap omits since the country is
  // implicit, WorldVisitMap fills it in for disambiguation.
  countryName?: string
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

// =============================================================================
// World visit map — country outlines + city dots aggregated by city
// =============================================================================

export function WorldVisitMap({ cities }: { cities: CityVisitsEntry[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<CityTooltip | null>(null)

  // Single projection drives both country polygons and city points so
  // dots line up with the underlying outlines.
  const projection = useMemo(
    () => geoEqualEarth().fitSize([WORLD_VIEW_W, WORLD_VIEW_H], COUNTRIES_FC),
    [],
  )
  const path = useMemo(() => geoPath(projection), [projection])

  const projectedCities = useMemo(() => {
    return cities
      .map((c) => {
        const xy = projection([c.lng, c.lat])
        if (!xy) return null
        return { city: c, x: xy[0], y: xy[1] }
      })
      .filter((v): v is { city: CityVisitsEntry; x: number; y: number } => v != null)
      // Largest dots first so smaller ones stay reachable on hover.
      .sort((a, b) => b.city.count - a.city.count)
  }, [cities, projection])

  function handleEnter(c: CityVisitsEntry, evt: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    setTooltip({
      city: c.city,
      region: c.region,
      countryName: countryDisplayName(c.country),
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
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-md bg-gray-200 dark:bg-[#080808]">
      <svg
        viewBox={`0 0 ${WORLD_VIEW_W} ${WORLD_VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="World map of human visits by city"
      >
        {/* Country polygons — white on light gray, black on dark gray.
            Keyed by index because some world-atlas features lack a usable
            id (disputed territories), which would collide on String(undef). */}
        {COUNTRIES_FC.features.map((geo, i) => (
          <path
            key={`country-${i}`}
            d={path(geo) ?? undefined}
            className="fill-white stroke-gray-400 dark:fill-black dark:stroke-[#222222]"
            strokeWidth={0.4}
          />
        ))}
        {/* City dots — half the radius of the US view since the world
            projection has roughly twice the linear scale per pixel and
            full-size dots end up swamping their countries. */}
        {projectedCities.map(({ city, x, y }) => (
          <circle
            key={`${city.country}|${city.region ?? ''}|${city.city}`}
            cx={x}
            cy={y}
            r={dotRadius(city.count) * 0.5}
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
          {tooltip.countryName && (
            <div className="mt-0.5 text-muted">{tooltip.countryName}</div>
          )}
        </div>
      )}
    </div>
  )
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
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-md bg-gray-200 dark:bg-[#080808]">
      <svg
        viewBox={`0 0 ${US_VIEW_W} ${US_VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="US map of human visits by city"
      >
        {/* State polygons — white on light gray, black on dark gray.
            Index keyed for consistency with the world map (FIPS ids are
            present on us-atlas, but positional keys are equally safe). */}
        {US_STATES_FC.features.map((s, i) => (
          <path
            key={`state-${i}`}
            d={path(s) ?? undefined}
            className="fill-white stroke-gray-400 dark:fill-black dark:stroke-[#222222]"
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
