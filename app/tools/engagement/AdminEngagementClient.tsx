'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import Page from '@/app/components/Page'
import { useContentIsPortrait } from '@/app/hooks/useContentIsPortrait'
import { Card, CardHeader } from '@/app/tools/_components/Card'
import { UsVisitMap, WorldVisitMap } from './VisitMap'
import { AdminFiltersModal } from '@/app/tools/_components/AdminFiltersModal'
import { AdminSettingsButton } from '@/app/tools/_components/AdminSettingsButton'
import {
  CalendarIcon,
  DownloadIcon,
  EyeIcon,
  LinkIcon,
  SpinnerIcon,
} from '@/app/components/icons'
import {
  EMPTY_FILTER_OPTIONS,
  decodeFiltersFromApi,
  encodeFiltersForApi,
  hasChip,
  type AdminFilters,
  type FilterChipKind,
} from '@/app/tools/_components/filters'
import { useAdminFilters } from '@/app/tools/_components/useAdminFilters'

const ENGAGEMENT_FILTER_KINDS: FilterChipKind[] = [
  'presenter',
  'product',
  'merchant',
  'region',
]
import { SegmentedControl } from '@/app/tools/_components/SegmentedControl'
import { TOOLTIP_STYLE, PALETTE, pickStableColor } from '@/app/tools/_components/chartTheme'
import { sliceLast } from '@/app/tools/_components/series'
import type {
  EngagementResponse,
  EventCounts,
  FunnelCounts,
  LengthBin,
  PauseBin,
  PauseDropoff,
  SharedBreakdown,
  SharedBreakdownEntry,
  TopShareEntry,
  TopSharePresenter,
} from '@/app/api/tools/engagement/route'

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

// Donut center overlay — copied from /tools/usage. If we add a third
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

function formatPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

// Compact variant of the shared StatBox: smaller, centered. Labels wrap to
// multiple lines as the card narrows — previously forced single-line via
// whitespace-nowrap, but that locked a ~150px min-content on the stat box
// that propagated up to the Card and prevented the page from shrinking.
function CompactStatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background p-4">
      <span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
      <span className="mt-1 text-center text-[10px] font-medium uppercase tracking-tight text-muted">
        {label}
      </span>
    </div>
  )
}

function EventCountsQuad({ counts }: { counts: EventCounts }) {
  return (
    <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3">
      <CompactStatBox label="Total Page Visits" value={counts.totalPageVisits.toLocaleString()} />
      <CompactStatBox label="Unique Page Visitors" value={counts.uniquePageVisitors.toLocaleString()} />
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

function selectTopShares(
  shares: EngagementResponse['topShares'],
  w: WindowAll,
): TopShareEntry[] {
  switch (w) {
    case 7:
      return shares.last7d
    case 30:
      return shares.last30d
    case 90:
      return shares.last90d
    case 'all':
      return shares.allTime
  }
}

// Numeric columns descend by default; text columns ascend by default.
// "presenter" sorts by display name (or email fallback) lexicographically.
type TopSharesSortKey =
  | 'slug'
  | 'presenter'
  | 'pageVisits'
  | 'uniquePageVisitors'
  | 'plays'
  | 'videoEnds'
  | 'copyLinkClicks'
  | 'downloadClicks'
  | 'interactiveClicks'
  | 'bookDemoClicks'

const NUMERIC_KEYS: ReadonlySet<TopSharesSortKey> = new Set([
  'pageVisits',
  'uniquePageVisitors',
  'plays',
  'videoEnds',
  'copyLinkClicks',
  'downloadClicks',
  'interactiveClicks',
  'bookDemoClicks',
])

function defaultSortDir(key: TopSharesSortKey): 'asc' | 'desc' {
  return NUMERIC_KEYS.has(key) ? 'desc' : 'asc'
}

function presenterName(p: TopSharePresenter | null): string {
  if (!p) return ''
  const full = `${p.firstName} ${p.lastName}`.trim()
  return full || p.email
}

function compareTopShares(
  a: TopShareEntry,
  b: TopShareEntry,
  key: TopSharesSortKey,
  dir: 'asc' | 'desc',
): number {
  const factor = dir === 'asc' ? 1 : -1
  // Presenter sorts by computed display name; fall back to standard
  // property indexing for everything else.
  const av =
    key === 'presenter' ? presenterName(a.presenter) : (a as Record<string, unknown>)[key]
  const bv =
    key === 'presenter' ? presenterName(b.presenter) : (b as Record<string, unknown>)[key]
  if (av == null && bv == null) return 0
  if (av == null || av === '') return 1
  if (bv == null || bv === '') return -1
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * factor
  }
  return String(av).localeCompare(String(bv)) * factor
}

function TopSharesTable({ rows }: { rows: TopShareEntry[] }) {
  const [sortKey, setSortKey] = useState<TopSharesSortKey>('pageVisits')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareTopShares(a, b, sortKey, sortDir)),
    [rows, sortKey, sortDir],
  )

  function clickHeader(k: TopSharesSortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      setSortDir(defaultSortDir(k))
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted">No share visits in this window.</p>
  }

  type Col = {
    key: TopSharesSortKey
    label: React.ReactNode
    // Used as the column header's title attribute (tooltip) and as the
    // sort button's aria-label so icon-only columns stay accessible.
    title: string
    align: 'left' | 'right'
    render: (r: TopShareEntry) => React.ReactNode
  }
  const cols: Col[] = [
    {
      key: 'slug',
      label: 'Slug',
      title: 'Slug — links to the share page',
      align: 'left',
      render: (r) => (
        <a
          href={`/video-demos/${r.slug}`}
          target="_blank"
          rel="noreferrer"
          className="block max-w-[14rem] truncate text-foreground hover:underline"
          title={r.slug}
        >
          {r.slug}
        </a>
      ),
    },
    {
      key: 'presenter',
      label: 'Presenter',
      title: 'Share creator',
      align: 'left',
      render: (r) => {
        const name = presenterName(r.presenter)
        return name ? (
          <span
            className="block max-w-[12rem] truncate text-foreground"
            title={r.presenter?.email ?? name}
          >
            {name}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )
      },
    },
    {
      key: 'pageVisits',
      label: 'Visits',
      title: 'Total page visits (humans + bots)',
      align: 'right',
      render: (r) => r.pageVisits.toLocaleString(),
    },
    {
      key: 'uniquePageVisitors',
      label: 'Unique',
      title: 'Distinct page-visitors (visitor_id × slug)',
      align: 'right',
      render: (r) => r.uniquePageVisitors.toLocaleString(),
    },
    {
      key: 'plays',
      label: 'Play',
      title: 'Distinct viewers who pressed play',
      align: 'right',
      render: (r) => r.plays.toLocaleString(),
    },
    {
      key: 'videoEnds',
      label: 'End',
      title: 'Distinct viewers who reached the end of the video',
      align: 'right',
      render: (r) => r.videoEnds.toLocaleString(),
    },
    {
      key: 'copyLinkClicks',
      label: <LinkIcon width={14} height={14} />,
      title: 'Copy Link clicks',
      align: 'right',
      render: (r) => r.copyLinkClicks.toLocaleString(),
    },
    {
      key: 'downloadClicks',
      label: <DownloadIcon width={14} height={14} />,
      title: 'Download Video clicks',
      align: 'right',
      render: (r) => r.downloadClicks.toLocaleString(),
    },
    {
      key: 'interactiveClicks',
      label: <EyeIcon width={14} height={14} />,
      title: 'Explore Interactive Preview clicks',
      align: 'right',
      render: (r) => r.interactiveClicks.toLocaleString(),
    },
    {
      key: 'bookDemoClicks',
      label: <CalendarIcon width={14} height={14} />,
      title: 'Book a Demo clicks',
      align: 'right',
      render: (r) => r.bookDemoClicks.toLocaleString(),
    },
  ]

  // Sticky-column classes. The slug column always sticks to the left so
  // viewers can identify rows after horizontal scrolling. bg-surface matches
  // the surrounding row (so it visually disappears but still covers cells
  // scrolling past underneath); the right border draws the separator line
  // between the pinned column and the rest of the table. z-10 keeps it
  // above other cells during scroll.
  function pinClass(key: TopSharesSortKey): string {
    if (key === 'slug') {
      return 'sticky left-0 z-10 bg-surface border-r border-border'
    }
    return ''
  }

  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-surface text-xs uppercase text-muted">
          <tr>
            {cols.map((c) => {
              const active = c.key === sortKey
              return (
                <th
                  key={c.key}
                  className={[
                    'cursor-pointer select-none px-3 py-2 font-medium transition-colors hover:text-foreground',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    active ? 'text-foreground' : '',
                    pinClass(c.key),
                  ].join(' ')}
                  onClick={() => clickHeader(c.key)}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  aria-label={c.title}
                  title={c.title}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {active && (
                      <span aria-hidden className="text-[10px]">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.slug} className="border-t border-border">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={[
                    'px-3 py-2 tabular-nums',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    pinClass(c.key),
                  ].join(' ')}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
  // CTA stages are parallel rather than sequential — a viewer who hits
  // Book Demo without clicking Copy Link still appears in the Book Demo
  // bar. Listing them last and ordered roughly by intent (sharing →
  // saving → exploring → talking to sales) reads as a natural funnel
  // tail without misrepresenting the per-stage independence.
  const stages: { label: string; key: keyof FunnelCounts }[] = [
    { label: 'Visited', key: 'human_visit' },
    { label: 'Played', key: 'video_play' },
    { label: '25%', key: 'q25' },
    { label: '50%', key: 'q50' },
    { label: '75%', key: 'q75' },
    { label: 'Finished', key: 'video_end' },
    { label: 'Copy Link', key: 'click_copy_link' },
    { label: 'Download', key: 'click_download' },
    { label: 'Interactive', key: 'click_interactive_demo' },
    { label: 'Book Demo', key: 'click_book_demo' },
  ]
  const top = counts.human_visit
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
  const isPortrait = useContentIsPortrait()
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'loading' })
  const data = fetchState.status === 'ready' ? fetchState.data : null

  const [filters, setFilters] = useAdminFilters('vlad_admin_filters_engagement')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Merge any chips passed in via ?filters= into the visible filter
  // state, then strip the param from the URL. /tools/page.tsx uses
  // this to seed a regular user's first visit with their own
  // include-presenter chip; the chip then shows up in the modal so
  // the user can see it's applied and remove it like any other chip.
  // Merging (not replacing) preserves whatever the user previously
  // saved on this device. One-shot per mount via the ref guard;
  // stripping the param means a refresh won't re-add a removed chip.
  const urlFiltersAppliedRef = useRef(false)
  useEffect(() => {
    if (urlFiltersAppliedRef.current) return
    if (typeof window === 'undefined') return
    urlFiltersAppliedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const raw = params.get('filters')
    if (!raw) return

    const incoming = decodeFiltersFromApi(raw)
    if (incoming.include.length === 0 && incoming.exclude.length === 0) return

    const merged: AdminFilters = {
      include: [...filters.include],
      exclude: [...filters.exclude],
    }
    for (const c of incoming.include) {
      if (!hasChip(merged.include, c)) merged.include.push(c)
    }
    for (const c of incoming.exclude) {
      if (!hasChip(merged.exclude, c)) merged.exclude.push(c)
    }
    setFilters(merged)

    params.delete('filters')
    const rest = params.toString()
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (rest ? `?${rest}` : ''),
    )
    // Mount-only sync of URL → filter state. Including `filters` in
    // deps would re-run on every chip change and re-add the URL chip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // String-stable so the fetch effect only fires when filter content
  // actually changes (not on every parent re-render).
  const filtersParam = encodeFiltersForApi(filters)

  useEffect(() => {
    let cancelled = false
    const url = filtersParam
      ? `/api/tools/engagement?filters=${encodeURIComponent(filtersParam)}`
      : '/api/tools/engagement'
    fetch(url, { cache: 'no-store' })
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
  }, [filtersParam])

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

  const filtersActive =
    filters.include.length > 0 || filters.exclude.length > 0
  const filterOptions = data?.filterOptions ?? EMPTY_FILTER_OPTIONS

  if (fetchState.status === 'loading') {
    return (
      <Page>
        <div className="flex items-center justify-center py-20">
          <SpinnerIcon className="animate-spin text-muted" width={32} height={32} />
        </div>
      </Page>
    )
  }

  if (fetchState.status === 'error') {
    return (
      <Page>
        <p className="text-sm text-red-500">{fetchState.message}</p>
      </Page>
    )
  }

  return (
    <Page>
      <AdminSettingsButton active={filtersActive} onClick={() => setFiltersOpen(true)} />
      {filtersOpen && (
        <AdminFiltersModal
          filters={filters}
          onChange={setFilters}
          options={filterOptions}
          enabledKinds={ENGAGEMENT_FILTER_KINDS}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      <div className="w-full space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Engagement Statistics
          </h1>
          <h3 className="mt-1 text-muted">How shared previews are landing.</h3>
        </div>

        {/* Row 1: Top shares leaderboard. Per-slug performance ranking. */}
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
          <TopSharesTable
            rows={selectTopShares(fetchState.data.topShares, leaderboardWindow)}
          />
          <p className="mt-2 text-xs text-muted">
            Click a column header to sort. Slug links to the share page in a new
            tab. <span className="font-medium">Visits</span> counts page renders
            (humans + bots); <span className="font-medium">Unique</span> = distinct
            visitor_id from human_visit; <span className="font-medium">Play</span>{' '}
            / <span className="font-medium">End</span> count distinct viewers who
            pressed play / reached the end of the video. The four icon columns
            count raw click events on each CTA button (multiple clicks per viewer
            all count): link = Copy Link, arrow = Download, eye = Explore
            Interactive Preview, calendar = Book a Demo.
          </p>
        </Card>

        {/* Row 2: Visits over time (time-series) + Event counts (stat quad).
            Mirrors the Active users / User counts pairing on /tools/usage. */}
        <div className={`grid grid-cols-1 gap-6 ${isPortrait ? '' : 'md:grid-cols-3'}`}>
          <Card className={isPortrait ? '' : 'md:col-span-2'}>
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
            <EventCountsQuad counts={selectCounts(fetchState.data.eventCounts, countsWindow)} />
          </Card>
        </div>

        {/* Row 3: Conversion funnel (full width). Most load-bearing plot —
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
          <ConversionFunnel
            counts={selectFunnel(fetchState.data.funnel, funnelWindow)}
          />
        </Card>

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
          <WatchDropoffChart
            bins={selectLengthBins(fetchState.data.lengthBinDropoff, dropoffWindow)}
          />
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
              <div className="flex flex-wrap items-center gap-3">
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
          <PauseHotspotsChart
            dropoff={selectPauseDropoff(fetchState.data.pauseDropoff, pauseWindow)}
            mode={pauseMode}
          />
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
              <div className="flex flex-wrap items-center gap-3">
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
          {mapView === 'us' ? (
            <UsVisitMap
              cities={selectCityVisits(fetchState.data.cityVisits, mapWindow)}
            />
          ) : (
            <WorldVisitMap
              cities={selectCityVisits(fetchState.data.cityVisits, mapWindow)}
            />
          )}
          <p className="mt-2 text-xs text-muted">
            Desktop visits only. Mobile/cellular traffic is excluded because
            carrier NAT routes those visits through gateway IPs (most US cell
            traffic egresses through Ashburn, VA), so the geo we get for them
            is the gateway, not the user. Bots and pre-instrumentation visits
            also excluded. Dots aggregated by city; size scales with √visits.
          </p>
        </Card>

        {/* Row 7: Where shared — bot platforms vs. human referrers. Two
            halves of the same question; placed side-by-side at equal weight. */}
        <div className={`grid grid-cols-1 gap-6 ${isPortrait ? '' : 'md:grid-cols-2'}`}>
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
            <SharedDonut
              entries={
                selectShared(fetchState.data.sharedBreakdown, unfurlWindow).unfurlBots
              }
              labelFn={unfurlLabel}
              colorFn={unfurlColor}
              emptyText="No unfurl bot visits in this window."
            />
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
            <SharedDonut
              entries={
                selectShared(fetchState.data.sharedBreakdown, referrerWindow).referrers
              }
              labelFn={referrerLabel}
              colorFn={referrerColor}
              emptyText="No human visits in this window."
            />
          </Card>
        </div>
      </div>
    </Page>
  )
}
