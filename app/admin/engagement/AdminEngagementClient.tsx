'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Card, CardHeader } from '@/app/admin/_components/Card'
import { UsVisitMap, WorldVisitMap } from './VisitMap'
import { SegmentedControl } from '@/app/admin/_components/SegmentedControl'
import { TOOLTIP_STYLE, PALETTE, pickStableColor } from '@/app/admin/_components/chartTheme'
import { sliceLast } from '@/app/admin/_components/series'
import type {
  EngagementResponse,
  EventCounts,
  FunnelCounts,
  LengthBin,
  PauseBin,
  PauseDropoff,
  SharedBreakdown,
  SharedBreakdownEntry,
} from '@/app/api/admin/engagement/route'

type WindowDays = 7 | 30 | 90
type WindowAll = WindowDays | 'all'

// Mirror the usage dashboard's color principles: orange anchors the
// "celebrated" category in each chart (analogous to new users / renders
// in usage), cool tones carry the rest, slate for noise. Green is
// reserved for success; red never appears.
//
// Mobile gets orange because it's the meaningful B2B signal — exec
// opening a share from their phone matters more than another desktop
// click. Desktop is the calm primary (blue, like returning users).
const COLOR_DESKTOP = PALETTE.BLUE      // most common human bucket
const COLOR_MOBILE = PALETTE.ORANGE     // celebrated — mobile engagement
const COLOR_TABLET = PALETTE.INDIGO
const COLOR_OTHER = PALETTE.CYAN
const COLOR_BOT = PALETTE.SLATE

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Per-kind color maps so each category renders in the same color across
// every refresh / window toggle / count order — even when categories are
// missing from the current view. New kinds (added to the bot detector or
// referrer parser) hash deterministically to a fallback palette via
// pickStableColor, so they're stable too.

const UNFURL_LABELS: Record<string, string> = {
  slackbot: 'Slack',
  linkedinbot: 'LinkedIn',
  twitterbot: 'Twitter / X',
  discordbot: 'Discord',
  facebookexternalhit: 'Facebook',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  generic: 'Other crawlers',
  unknown: 'Unknown',
}

const UNFURL_COLORS: Record<string, string> = {
  slackbot: PALETTE.BLUE,
  linkedinbot: PALETTE.INDIGO,
  twitterbot: PALETTE.CYAN,
  discordbot: PALETTE.TEAL,
  facebookexternalhit: PALETTE.ORANGE,
  // Long-tail unfurl bots and uncategorized crawlers share slate — the
  // legend disambiguates by name.
  whatsapp: PALETTE.SLATE,
  telegram: PALETTE.SLATE,
  generic: PALETTE.SLATE,
  unknown: PALETTE.SLATE,
}

const REFERRER_LABELS: Record<string, string> = {
  slack: 'Slack',
  linkedin: 'LinkedIn',
  twitter: 'Twitter / X',
  email: 'Email',
  internal: 'Internal',
  localhost: 'Localhost (dev)',
  direct: 'Direct',
  other: 'Other',
}

const REFERRER_COLORS: Record<string, string> = {
  // internal is locked to ORANGE per design — team usage is the slice
  // the dashboard reader most often wants to spot at a glance.
  internal: PALETTE.ORANGE,
  // direct gets the calm primary. In B2B much of real human traffic
  // arrives without a Referer (email apps strip it, deep links from
  // native clients), so direct ≠ noise — it deserves its own slot.
  direct: PALETTE.BLUE,
  slack: PALETTE.VIOLET,
  linkedin: PALETTE.INDIGO,
  email: PALETTE.TEAL,
  twitter: PALETTE.CYAN,
  // localhost + other are dev / unknown noise. Same color, different
  // legend labels — read as one "uninteresting" visual group.
  localhost: PALETTE.SLATE,
  other: PALETTE.SLATE,
}

function unfurlLabel(kind: string): string {
  return UNFURL_LABELS[kind] ?? kind
}

function referrerLabel(kind: string): string {
  return REFERRER_LABELS[kind] ?? kind
}

// Synthetic "__other" bucket created when categories exceed palette size;
// always slate. For real categories, fall through to the explicit map; if
// missing (e.g. a new bot kind we haven't mapped), pick a stable color
// by hashing the kind so it never shifts.
const SHARED_FALLBACK_PALETTE = [
  PALETTE.BLUE,
  PALETTE.TEAL,
  PALETTE.CYAN,
  PALETTE.INDIGO,
  PALETTE.VIOLET,
] as const

function unfurlColor(kind: string): string {
  if (kind === '__other') return PALETTE.SLATE
  return pickStableColor(kind, UNFURL_COLORS, SHARED_FALLBACK_PALETTE)
}

function referrerColor(kind: string): string {
  if (kind === '__other') return PALETTE.SLATE
  return pickStableColor(kind, REFERRER_COLORS, SHARED_FALLBACK_PALETTE)
}

// Donut center overlay — copied from /admin/usage. If we add a third
// dashboard with the same component, extract to app/admin/_components.
//
// `-z-10` places it behind the chart's SVG and tooltip; the donut hole
// is transparent so the text still shows through the center, but a
// hover tooltip drawn over the center will sit in front of it. Requires
// the parent to form a stacking context (e.g. `isolate`), otherwise
// negative z escapes the card and stacks against page-level content.
function PieCenterTotal({ value }: { value: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 flex flex-col items-center justify-center">
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">Total</span>
    </div>
  )
}

function PieLegend({
  entries,
}: {
  entries: { name: string; value: number; color: string }[]
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
      {entries.map((e) => (
        <span key={e.name} className="flex items-center gap-1.5 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: e.color }} />
          {e.name}
          <span className="tabular-nums text-foreground">{e.value}</span>
        </span>
      ))}
    </div>
  )
}

// Generic donut card body for the two "where shared" panels. Color is
// looked up by kind via the caller's colorFn — same kind always renders
// the same color, regardless of count order or which other categories
// are present. Top 5 + a synthetic "__other" bucket keeps the donut
// legible if the long tail of kinds gets large.
function SharedDonut({
  entries,
  labelFn,
  colorFn,
  emptyText,
}: {
  entries: SharedBreakdownEntry[]
  labelFn: (kind: string) => string
  colorFn: (kind: string) => string
  emptyText: string
}) {
  const SLICE_LIMIT = 6
  type Slice = { kind: string; name: string; count: number }
  let slices: Slice[]
  if (entries.length <= SLICE_LIMIT) {
    slices = entries.map((e) => ({ kind: e.kind, name: labelFn(e.kind), count: e.count }))
  } else {
    const top = entries
      .slice(0, SLICE_LIMIT - 1)
      .map((e) => ({ kind: e.kind, name: labelFn(e.kind), count: e.count }))
    const otherCount = entries
      .slice(SLICE_LIMIT - 1)
      .reduce((sum, e) => sum + e.count, 0)
    slices = otherCount > 0
      ? [...top, { kind: '__other', name: 'Other', count: otherCount }]
      : top
  }

  const total = slices.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return <p className="text-sm text-muted">{emptyText}</p>

  return (
    <div className="h-64">
      <div className="relative isolate h-48">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="name"
              innerRadius="55%"
              outerRadius="80%"
              stroke="var(--surface)"
            >
              {slices.map((s) => (
                <Cell key={s.kind} fill={colorFn(s.kind)} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <PieCenterTotal value={total} />
      </div>
      <PieLegend
        entries={slices.map((s) => ({
          name: s.name,
          value: s.count,
          color: colorFn(s.kind),
        }))}
      />
    </div>
  )
}

const WINDOW_OPTIONS: { value: WindowDays; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

const WINDOW_OPTIONS_ALL: { value: WindowAll; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 'all', label: 'All' },
]

// Visual placeholder for any card whose data isn't wired yet. We show
// what the card WILL contain so design discussion is grounded.
function StubBody({
  data,
  plot,
  purpose,
  height = 'h-64',
}: {
  data: string
  plot: string
  purpose: string
  height?: string
}) {
  return (
    <div
      className={`flex ${height} flex-col items-center justify-center rounded-md border border-dashed border-border bg-background/40 p-6 text-center`}
    >
      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
        TODO · wire data
      </span>
      <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-xs">
        <dt className="font-semibold uppercase tracking-wider text-muted">Data</dt>
        <dd className="text-foreground">{data}</dd>
        <dt className="font-semibold uppercase tracking-wider text-muted">Plot</dt>
        <dd className="text-foreground">{plot}</dd>
        <dt className="font-semibold uppercase tracking-wider text-muted">Purpose</dt>
        <dd className="text-foreground">{purpose}</dd>
      </dl>
    </div>
  )
}

function formatPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

// Compact variant of the shared StatBox: smaller, centered, single-line
// label so the longest engagement label ("Unique Human Visitors") fits
// without wrapping inside the col-1 grid cell.
function CompactStatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background p-4">
      <span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
      <span className="mt-1 whitespace-nowrap text-center text-[10px] font-medium uppercase tracking-tight text-muted">
        {label}
      </span>
    </div>
  )
}

function EventCountsQuad({ counts }: { counts: EventCounts }) {
  return (
    <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3">
      <CompactStatBox label="Total Visits" value={counts.totalVisits.toLocaleString()} />
      <CompactStatBox label="Unique Human Visitors" value={counts.uniqueVisitors.toLocaleString()} />
      <CompactStatBox label="Mobile %" value={formatPct(counts.mobilePct)} />
      <CompactStatBox label="Bot %" value={formatPct(counts.botPct)} />
    </div>
  )
}

// Map the per-card window control to the API's pre-computed bucket key.
function selectCounts(
  eventCounts: EngagementResponse['eventCounts'],
  w: WindowAll,
): EventCounts {
  switch (w) {
    case 7:
      return eventCounts.last7d
    case 30:
      return eventCounts.last30d
    case 90:
      return eventCounts.last90d
    case 'all':
      return eventCounts.allTime
  }
}

function selectFunnel(
  funnel: EngagementResponse['funnel'],
  w: WindowAll,
): FunnelCounts {
  switch (w) {
    case 7:
      return funnel.last7d
    case 30:
      return funnel.last30d
    case 90:
      return funnel.last90d
    case 'all':
      return funnel.allTime
  }
}

function selectShared(
  shared: EngagementResponse['sharedBreakdown'],
  w: WindowAll,
): SharedBreakdown {
  switch (w) {
    case 7:
      return shared.last7d
    case 30:
      return shared.last30d
    case 90:
      return shared.last90d
    case 'all':
      return shared.allTime
  }
}

function selectLengthBins(
  dropoff: EngagementResponse['lengthBinDropoff'],
  w: WindowAll,
): LengthBin[] {
  switch (w) {
    case 7:
      return dropoff.last7d
    case 30:
      return dropoff.last30d
    case 90:
      return dropoff.last90d
    case 'all':
      return dropoff.allTime
  }
}

function selectPauseDropoff(
  dropoff: EngagementResponse['pauseDropoff'],
  w: WindowAll,
): PauseDropoff {
  switch (w) {
    case 7:
      return dropoff.last7d
    case 30:
      return dropoff.last30d
    case 90:
      return dropoff.last90d
    case 'all':
      return dropoff.allTime
  }
}

function selectGeoVisits(
  geo: EngagementResponse['geoVisits'],
  w: WindowAll,
): EngagementResponse['geoVisits']['allTime'] {
  switch (w) {
    case 7:
      return geo.last7d
    case 30:
      return geo.last30d
    case 90:
      return geo.last90d
    case 'all':
      return geo.allTime
  }
}

function selectCityVisits(
  city: EngagementResponse['cityVisits'],
  w: WindowAll,
): EngagementResponse['cityVisits']['allTime'] {
  switch (w) {
    case 7:
      return city.last7d
    case 30:
      return city.last30d
    case 90:
      return city.last90d
    case 'all':
      return city.allTime
  }
}

const MAP_VIEW_OPTIONS: { value: 'us' | 'world'; label: string }[] = [
  { value: 'us', label: 'US' },
  { value: 'world', label: 'World' },
]

// Histogram of pause locations. Two views toggle the same data:
//   - normalized: bin currentTime/duration into 5% buckets (0..95%)
//   - absolute:   bin currentTime into 5s buckets (0..175s + 180+s overflow)
// Bars touch (barCategoryGap=1) for the classic histogram look. Empty
// brackets render as zero-height columns so gaps in the data are visible.
function PauseHotspotsChart({
  dropoff,
  mode,
}: {
  dropoff: PauseDropoff
  mode: 'normalized' | 'absolute'
}) {
  const data: PauseBin[] = mode === 'normalized' ? dropoff.normalized : dropoff.absolute
  const total = data.reduce((sum, b) => sum + b.count, 0)
  if (total === 0) {
    return (
      <p className="text-sm text-muted">
        {mode === 'normalized'
          ? 'No pauses with a captured video duration in this window. Older events lack duration and only appear in the seconds view — toggle to Seconds.'
          : 'No pauses captured in this window. Pauses are recorded only for browsers that played the video.'}
      </p>
    )
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          barCategoryGap={1}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            stroke="var(--muted)"
            fontSize={10}
            angle={-45}
            textAnchor="end"
            interval={0}
            height={50}
          />
          <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="count" name="Pauses" fill={PALETTE.VIOLET} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Watch dropoff bucketed by video length. Within each bin we show 4
// grouped bars — % of plays that reached 25% / 50% / 75% / finished,
// normalized so play=100% per bin. The Play stage isn't drawn (always
// 100% by definition of the baseline). "Longer videos drop off faster"
// shows up directly: bars shrink more steeply as bin length increases.
//
// Stage colors progress indigo → blue → cyan → green within each bin so
// the funnel reads left-to-right. Green anchors "Finished" — completion
// is the success state, matching the green = success language elsewhere.
const COLOR_STAGE_Q25 = PALETTE.INDIGO
const COLOR_STAGE_Q50 = PALETTE.BLUE
const COLOR_STAGE_Q75 = PALETTE.CYAN
const COLOR_STAGE_END = PALETTE.GREEN

type DropoffRow = {
  label: string
  q25: number
  q50: number
  q75: number
  end: number
  // Raw counts kept around for the tooltip — formatter shows
  // "75% (12 viewers)".
  rawPlay: number
  rawQ25: number
  rawQ50: number
  rawQ75: number
  rawEnd: number
}

function pctOf(num: number, denom: number): number {
  return denom > 0 ? (num / denom) * 100 : 0
}

function WatchDropoffChart({ bins }: { bins: LengthBin[] }) {
  // bins are always pre-populated 0–15…180+ on the server; "no data"
  // means every bracket is empty (no plays with a captured duration in
  // this window).
  if (bins.length === 0 || bins.every((b) => b.play === 0)) {
    return (
      <p className="text-sm text-muted">
        No video events with duration in this window. Older events instrumented
        before length-bin tracking are excluded — play a video on a share page
        to populate this chart.
      </p>
    )
  }
  const data: DropoffRow[] = bins.map((b) => ({
    label: b.label,
    q25: pctOf(b.q25, b.play),
    q50: pctOf(b.q50, b.play),
    q75: pctOf(b.q75, b.play),
    end: pctOf(b.end, b.play),
    rawPlay: b.play,
    rawQ25: b.q25,
    rawQ50: b.q50,
    rawQ75: b.q75,
    rawEnd: b.end,
  }))
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          barGap={0}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} />
          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => {
              const pct = typeof value === 'number' ? `${Math.round(value)}%` : '—'
              return [pct, name]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="q25" name="25%" fill={COLOR_STAGE_Q25} />
          <Bar dataKey="q50" name="50%" fill={COLOR_STAGE_Q50} />
          <Bar dataKey="q75" name="75%" fill={COLOR_STAGE_Q75} />
          <Bar dataKey="end" name="Finished" fill={COLOR_STAGE_END} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Horizontal funnel rendered as 7 stacked bar rows. Each row shows:
//   [stage label]  [bar — width ∝ count / top stage]  [count]  [% of top]
//
// Percent is each stage's count as a fraction of the top stage (Visited),
// not stage-to-stage. Top-relative answers "what % of visitors made it
// this far?" in one read. Stage-to-stage breaks visually as soon as any
// upstream stage hits zero — every row below shows "—" because n/0 is
// undefined.
function ConversionFunnel({ counts }: { counts: FunnelCounts }) {
  const stages: { label: string; key: keyof FunnelCounts }[] = [
    { label: 'Visited', key: 'visit_linked' },
    { label: 'Played', key: 'video_play' },
    { label: '25%', key: 'q25' },
    { label: '50%', key: 'q50' },
    { label: '75%', key: 'q75' },
    { label: 'Finished', key: 'video_end' },
    { label: 'Clicked CTA', key: 'click_any' },
  ]
  const top = counts.visit_linked
  return (
    <div className="space-y-2 py-2">
      {stages.map((s) => {
        const value = counts[s.key]
        const pct = top > 0 ? (value / top) * 100 : null
        const widthPct = pct ?? 0
        return (
          <div
            key={s.key}
            className="grid grid-cols-[6rem_1fr_4rem_3.5rem] items-center gap-3 text-sm"
          >
            <span className="truncate text-muted">{s.label}</span>
            <div className="relative h-6 rounded-md bg-background">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-[width]"
                style={{ width: `${widthPct}%`, background: PALETTE.ORANGE }}
              />
            </div>
            <span className="text-right tabular-nums text-foreground">
              {value.toLocaleString()}
            </span>
            <span className="text-right text-xs tabular-nums text-muted">
              {pct == null ? '—' : `${Math.round(pct)}%`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Loading/error/data are mutually exclusive — one union state avoids
// synchronous setState cascades inside the fetch effect.
type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: EngagementResponse }

export default function AdminEngagementClient() {
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })
  const data = fetchState.status === 'ready' ? fetchState.data : null

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/engagement', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: EngagementResponse | { error: string }) => {
        if (cancelled) return
        if ('error' in d) setFetchState({ status: 'error', message: d.error })
        else setFetchState({ status: 'ready', data: d })
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: 'error', message: 'Failed to load.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Per-card window state. Cards still in stub form keep their controls
  // functional locally so design refinement can preview behavior.
  const [visitsWindow, setVisitsWindow] = useState<WindowDays>(30)
  const [countsWindow, setCountsWindow] = useState<WindowAll>('all')
  const [funnelWindow, setFunnelWindow] = useState<WindowAll>(30)
  const [unfurlWindow, setUnfurlWindow] = useState<WindowAll>('all')
  const [referrerWindow, setReferrerWindow] = useState<WindowAll>('all')
  const [dropoffWindow, setDropoffWindow] = useState<WindowAll>(30)
  const [pauseWindow, setPauseWindow] = useState<WindowAll>('all')
  const [pauseMode, setPauseMode] = useState<'normalized' | 'absolute'>('normalized')
  const [mapWindow, setMapWindow] = useState<WindowAll>('all')
  const [mapView, setMapView] = useState<'us' | 'world'>('us')
  const [leaderboardWindow, setLeaderboardWindow] = useState<WindowAll>(30)

  // 90-day series sliced client-side based on the per-card window control.
  // Stack ordering puts bot last so the noise floor is visually capped on
  // top — easy to compare day-over-day and easy to mentally subtract.
  const visitsChartData = useMemo(
    () =>
      sliceLast(data?.visitsSeries ?? [], visitsWindow).map((p) => ({
        date: shortDate(p.date),
        rawDate: p.date,
        desktop: p.desktop,
        mobile: p.mobile,
        tablet: p.tablet,
        other: p.other,
        bot: p.bot,
      })),
    [data, visitsWindow],
  )

  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <div className="w-full max-w-5xl space-y-6">
        <div className="grid grid-cols-3 items-start">
          <div className="col-start-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Engagement Statistics
            </h1>
            <h3 className="mt-1 text-muted">How shared previews are landing.</h3>
          </div>
          <Link
            href="/admin"
            className="col-start-3 mt-1 justify-self-end text-sm text-muted hover:text-foreground"
          >
            ← Admin tools
          </Link>
        </div>

        {/* Row 1: Visits over time (time-series) + Event counts (stat quad).
            Mirrors the Active users / User counts pairing on /admin/usage. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader
              title="Visits over time"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS}
                  value={visitsWindow}
                  onChange={setVisitsWindow}
                />
              }
            />
            {fetchState.status === 'error' ? (
              <p className="text-sm text-red-500">{fetchState.message}</p>
            ) : fetchState.status === 'loading' ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart
                    data={visitsChartData}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                    <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="desktop" stackId="visits" fill={COLOR_DESKTOP} name="Desktop" />
                    <Bar dataKey="mobile" stackId="visits" fill={COLOR_MOBILE} name="Mobile" />
                    <Bar dataKey="tablet" stackId="visits" fill={COLOR_TABLET} name="Tablet" />
                    <Bar dataKey="other" stackId="visits" fill={COLOR_OTHER} name="Other" />
                    <Bar dataKey="bot" stackId="visits" fill={COLOR_BOT} name="Bot" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card className="flex flex-col">
            <CardHeader
              title="Event counts"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={countsWindow}
                  onChange={setCountsWindow}
                />
              }
            />
            {fetchState.status === 'error' ? (
              <p className="text-sm text-red-500">{fetchState.message}</p>
            ) : fetchState.status === 'loading' ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <EventCountsQuad counts={selectCounts(fetchState.data.eventCounts, countsWindow)} />
            )}
          </Card>
        </div>

        {/* Row 2: Conversion funnel (full width). Most load-bearing plot —
            stage-by-stage drop from page-load through video to CTA click. */}
        <Card>
          <CardHeader
            title="Conversion funnel"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={funnelWindow}
                onChange={setFunnelWindow}
              />
            }
          />
          {fetchState.status === 'error' ? (
            <p className="text-sm text-red-500">{fetchState.message}</p>
          ) : fetchState.status === 'loading' ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <ConversionFunnel
              counts={selectFunnel(fetchState.data.funnel, funnelWindow)}
            />
          )}
        </Card>

        {/* Row 3: Where shared — bot platforms vs. human referrers. Two
            halves of the same question; placed side-by-side at equal weight. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader
              title="Unfurl bot visits"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={unfurlWindow}
                  onChange={setUnfurlWindow}
                />
              }
            />
            {fetchState.status === 'error' ? (
              <p className="text-sm text-red-500">{fetchState.message}</p>
            ) : fetchState.status === 'loading' ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <SharedDonut
                entries={
                  selectShared(fetchState.data.sharedBreakdown, unfurlWindow).unfurlBots
                }
                labelFn={unfurlLabel}
                colorFn={unfurlColor}
                emptyText="No unfurl bot visits in this window."
              />
            )}
          </Card>
          <Card className="flex flex-col">
            <CardHeader
              title="Referrer sources"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={referrerWindow}
                  onChange={setReferrerWindow}
                />
              }
            />
            {fetchState.status === 'error' ? (
              <p className="text-sm text-red-500">{fetchState.message}</p>
            ) : fetchState.status === 'loading' ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <SharedDonut
                entries={
                  selectShared(fetchState.data.sharedBreakdown, referrerWindow).referrers
                }
                labelFn={referrerLabel}
                colorFn={referrerColor}
                emptyText="No human visits in this window."
              />
            )}
          </Card>
        </div>

        {/* Row 4: Watch dropoff bucketed by video length. Per-bin, 5 grouped
            bars normalized to play=100% — comparing bins side-by-side answers
            "do longer videos lose more viewers?" without being skewed by raw
            volume differences across length brackets. */}
        <Card>
          <CardHeader
            title="Watch dropoff by video length"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={dropoffWindow}
                onChange={setDropoffWindow}
              />
            }
          />
          {fetchState.status === 'error' ? (
            <p className="text-sm text-red-500">{fetchState.message}</p>
          ) : fetchState.status === 'loading' ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <WatchDropoffChart
              bins={selectLengthBins(fetchState.data.lengthBinDropoff, dropoffWindow)}
            />
          )}
          <p className="mt-2 text-xs text-muted">
            Each bar shows % of plays in that length bin reaching the stage.
            Play is the baseline (100%). Excludes events from before
            duration-on-beacon was instrumented.
          </p>
        </Card>

        {/* Row 5: Pause hotspots. Two views (normalized vs absolute) toggled
            via a secondary control — same data, different x-axis. */}
        <Card>
          <CardHeader
            title="Pause hotspots"
            controls={
              <div className="flex items-center gap-3">
                <SegmentedControl
                  options={[
                    { value: 'normalized', label: '% of video' },
                    { value: 'absolute', label: 'Seconds' },
                  ]}
                  value={pauseMode}
                  onChange={setPauseMode}
                />
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={pauseWindow}
                  onChange={setPauseWindow}
                />
              </div>
            }
          />
          {fetchState.status === 'error' ? (
            <p className="text-sm text-red-500">{fetchState.message}</p>
          ) : fetchState.status === 'loading' ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <PauseHotspotsChart
              dropoff={selectPauseDropoff(fetchState.data.pauseDropoff, pauseWindow)}
              mode={pauseMode}
            />
          )}
          <p className="mt-2 text-xs text-muted">
            Each bar counts pause events in that bucket. Spikes reveal content
            moments where viewers stop to think (or bail). Normalized view
            requires duration on the event — older pauses only appear in seconds.
          </p>
        </Card>

        {/* Row 6: Visit map. Geo distribution of real humans. Bots excluded
            because iplocate only fires on non-bot visit events. Tab
            switches between US (city-level dots) and World (country
            choropleth); both windows respect the same time-range toggle. */}
        <Card>
          <CardHeader
            title="Visit map"
            controls={
              <div className="flex items-center gap-3">
                <SegmentedControl
                  options={MAP_VIEW_OPTIONS}
                  value={mapView}
                  onChange={setMapView}
                />
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={mapWindow}
                  onChange={setMapWindow}
                />
              </div>
            }
          />
          {fetchState.status === 'error' ? (
            <p className="text-sm text-red-500">{fetchState.message}</p>
          ) : fetchState.status === 'loading' ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : mapView === 'us' ? (
            <UsVisitMap
              cities={selectCityVisits(fetchState.data.cityVisits, mapWindow)}
            />
          ) : (
            <WorldVisitMap
              entries={selectGeoVisits(fetchState.data.geoVisits, mapWindow)}
            />
          )}
          <p className="mt-2 text-xs text-muted">
            Bot/unfurl traffic excluded — iplocate only resolves on real visitor IPs.{' '}
            {mapView === 'us'
              ? 'Dots are aggregated by city; size scales with √visits. Visits captured before city/lat-lng was instrumented don’t appear.'
              : 'Hover a country to see top regions.'}
          </p>
        </Card>

        {/* Row 8: Top shares leaderboard. Per-slug performance ranking. */}
        <Card>
          <CardHeader
            title="Top shares"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={leaderboardWindow}
                onChange={setLeaderboardWindow}
              />
            }
          />
          <StubBody
            data="per-slug aggregates joined with vlad_renders for brand/product labels"
            plot="sortable table — columns: slug, brand, product, visits, unique visitors, plays, q75 reach, total CTA clicks"
            purpose="rank shares by performance; drives 'which previews are landing?' decisions"
          />
        </Card>
      </div>
    </div>
  )
}
