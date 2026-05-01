'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Modal from '@/app/components/Modal'
import type { AdminUser } from '@/app/api/admin/users/route'
import { AdminFiltersModal } from '@/app/admin/_components/AdminFiltersModal'
import { AdminSettingsButton } from '@/app/admin/_components/AdminSettingsButton'
import {
  EMPTY_FILTER_OPTIONS,
  encodeFiltersForApi,
  type FilterChipKind,
} from '@/app/admin/_components/filters'
import { useAdminFilters } from '@/app/admin/_components/useAdminFilters'

const USAGE_FILTER_KINDS: FilterChipKind[] = ['presenter', 'product', 'merchant']
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
import type { UsageResponse } from '@/app/api/admin/usage/route'
import { Card, CardHeader, StatBox } from '@/app/admin/_components/Card'
import { SegmentedControl } from '@/app/admin/_components/SegmentedControl'
import { TOOLTIP_STYLE, PALETTE, pickStableColor } from '@/app/admin/_components/chartTheme'
import { sliceLast } from '@/app/admin/_components/series'

type WindowDays = 7 | 30 | 90
type PieWindow = WindowDays | 'all'

// Punchy orange anchors "new users" and "renders" — the things we're
// celebrating. Cool tones (blue/teal/violet) carry the rest. Green is
// reserved for success; red never appears.
const COLOR_DAU = PALETTE.BLUE       // returning users
const COLOR_NEW = PALETTE.ORANGE     // first-time users
const COLOR_INTRO = PALETTE.BLUE
const COLOR_PRODUCT = PALETTE.TEAL
const COLOR_RENDER = PALETTE.ORANGE
const COLOR_OK = PALETTE.GREEN
const COLOR_RATIO = PALETTE.CYAN

// Pie palette for the product breakdown. Stable per product name —
// pickStableColor hashes the name to a fallback color so the same
// product always renders in the same color regardless of count order
// or which other products are present this window. Slate is reserved
// for the synthetic "Other" bucket so it never competes with real
// categories.
const PRODUCT_FALLBACK_COLORS = [
  PALETTE.ORANGE,
  PALETTE.BLUE,
  PALETTE.TEAL,
  PALETTE.CYAN,
  PALETTE.INDIGO,
  PALETTE.VIOLET,
] as const

const PRODUCT_EXPLICIT_COLORS: Record<string, string> = {
  Other: PALETTE.SLATE,
}

function productColor(name: string): string {
  return pickStableColor(name, PRODUCT_EXPLICIT_COLORS, PRODUCT_FALLBACK_COLORS)
}

const WINDOW_OPTIONS: { value: WindowDays; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

const PIE_WINDOW_OPTIONS: { value: PieWindow; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 'all', label: 'All' },
]

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function presenterLabel(p: { firstName: string; lastName: string; email: string }): string {
  const name = `${p.firstName} ${p.lastName}`.trim()
  return name || p.email
}

// `-z-10` places the total behind the chart so a hover tooltip drawn
// over the center sits in front. Donut hole is transparent so the text
// still shows through. Parent must form a stacking context (`isolate`)
// or the negative z escapes the card.
function PieCenterTotal({ value }: { value: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 flex flex-col items-center justify-center">
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">Total</span>
    </div>
  )
}

// Custom legend rendered below the chart so the chart's box is exactly the
// donut — the absolute overlay above can then center on the donut without
// being thrown off by the legend's space.
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

export default function AdminUsageClient() {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-card window state. Each chart slices the 90d series client-side.
  const [dauWindow, setDauWindow] = useState<WindowDays>(30)
  const [contentWindow, setContentWindow] = useState<WindowDays>(30)
  const [successWindow, setSuccessWindow] = useState<WindowDays>(30)
  const [efficiencyWindow, setEfficiencyWindow] = useState<WindowDays>(30)
  const [leaderboardWindow, setLeaderboardWindow] = useState<WindowDays>(30)
  const [productWindow, setProductWindow] = useState<PieWindow>('all')
  const [contentPieWindow, setContentPieWindow] = useState<PieWindow>('all')

  // Filters from the new shared modal — persists in localStorage,
  // forwarded to the API as the encoded `filters` query param.
  // `excludeUsers` is also derived from `filters.exclude` (presenter
  // chips) so the existing server-side user exclusion logic keeps
  // working until per-kind filtering is fully wired server-side.
  const [filters, setFilters] = useAdminFilters('vlad_admin_filters_usage')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const filtersParam = encodeFiltersForApi(filters)

  useEffect(() => {
    // Synchronous state resets at the top of the effect would trip the
    // set-state-in-effect lint rule and aren't needed: success/failure
    // setters below clear or replace the previous values, and stale
    // data stays visible during refetch (better UX than blanking).
    let cancelled = false
    const url = filtersParam
      ? `/api/admin/usage?filters=${encodeURIComponent(filtersParam)}`
      : '/api/admin/usage'
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: UsageResponse | { error: string }) => {
        if (cancelled) return
        if ('error' in d) setError(d.error)
        else {
          setData(d)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filtersParam])

  const dauChartData = useMemo(
    () =>
      sliceLast(data?.dauSeries ?? [], dauWindow).map((p) => ({
        date: shortDate(p.date),
        rawDate: p.date,
        returning: p.returning,
        newUsers: p.newUsers,
        returningEmails: p.returningEmails,
        newEmails: p.newEmails,
      })),
    [data, dauWindow],
  )

  const userByEmail = useMemo(() => {
    const map = new Map<string, AdminUser>()
    for (const u of data?.users ?? []) map.set(u.email, u)
    return map
  }, [data])

  type DauDetail = {
    rawDate: string
    returning: AdminUser[]
    newUsers: AdminUser[]
  }
  const [dauDetail, setDauDetail] = useState<DauDetail | null>(null)
  function openDauDetail(point: { rawDate: string; returningEmails: string[]; newEmails: string[] }) {
    const lookup = (email: string): AdminUser =>
      userByEmail.get(email) ?? { email, firstName: '', lastName: '' }
    setDauDetail({
      rawDate: point.rawDate,
      returning: point.returningEmails.map(lookup),
      newUsers: point.newEmails.map(lookup),
    })
  }

  const contentChartData = useMemo(
    () =>
      sliceLast(data?.contentSeries ?? [], contentWindow).map((p) => ({
        ...p,
        date: shortDate(p.date),
      })),
    [data, contentWindow],
  )

  const successChartData = useMemo(
    () =>
      sliceLast(data?.successRate ?? [], successWindow).map((p) => {
        const total = p.completed + p.failed
        return {
          date: shortDate(p.date),
          successPct: total > 0 ? (p.completed / total) * 100 : null,
          total,
        }
      }),
    [data, successWindow],
  )

  const efficiencyChartData = useMemo(
    () =>
      sliceLast(data?.efficiencyRatio ?? [], efficiencyWindow).map((p) => ({
        date: shortDate(p.date),
        ratio: p.ratio,
      })),
    [data, efficiencyWindow],
  )

  // Product breakdown — sum render counts per product over the window,
  // keep top 5 + "Other" so the pie stays legible. Window 'all' uses the
  // API's truly-all-time totals (not capped at the 90d series window).
  const productBreakdown = useMemo(() => {
    if (!data) return [] as { name: string; value: number }[]
    let totals: { name: string; value: number }[]
    if (productWindow === 'all') {
      // Prefer the API's truly-all-time field; fall back to summing all
      // 90 days of productSeries if the API hasn't been redeployed with
      // productTotalsAllTime yet.
      if (data.productTotalsAllTime && data.productTotalsAllTime.length > 0) {
        totals = data.productTotalsAllTime
          .map((row) => ({ name: row.product.name, value: row.count }))
          .filter((row) => row.value > 0)
          .sort((a, b) => b.value - a.value)
      } else {
        const sums = new Map<string, number>()
        for (const row of data.productSeries ?? []) {
          let count = 0
          for (const d of row.days) count += d.count
          sums.set(row.product.name, (sums.get(row.product.name) ?? 0) + count)
        }
        totals = [...sums.entries()]
          .map(([name, value]) => ({ name, value }))
          .filter((row) => row.value > 0)
          .sort((a, b) => b.value - a.value)
      }
    } else {
      const cutoff = new Date()
      cutoff.setUTCHours(0, 0, 0, 0)
      const cutoffMs = cutoff.getTime() - (productWindow - 1) * 24 * 60 * 60 * 1000
      totals = (data.productSeries ?? [])
        .map((row) => {
          let count = 0
          for (const d of row.days) {
            const ts = new Date(`${d.date}T00:00:00Z`).getTime()
            if (ts < cutoffMs) continue
            count += d.count
          }
          return { name: row.product.name, value: count }
        })
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
    }
    if (totals.length <= 6) return totals
    const top = totals.slice(0, 5)
    const otherValue = totals.slice(5).reduce((acc, r) => acc + r.value, 0)
    return otherValue > 0 ? [...top, { name: 'Other', value: otherValue }] : top
  }, [data, productWindow])

  const productPieTotal = useMemo(
    () => productBreakdown.reduce((acc, d) => acc + d.value, 0),
    [productBreakdown],
  )

  // Content pie data — when window is 'all' we use the API's all-time
  // totals (truly all time, not capped at 90d). Otherwise sum contentSeries
  // entries inside the chosen window.
  const contentPieData = useMemo(() => {
    if (!data) return [{ name: 'Intros', value: 0 }, { name: 'Products', value: 0 }, { name: 'Renders', value: 0 }]
    if (contentPieWindow === 'all') {
      return [
        { name: 'Intros', value: data.contentTotalsAllTime?.intros ?? 0 },
        { name: 'Products', value: data.contentTotalsAllTime?.products ?? 0 },
        { name: 'Renders', value: data.contentTotalsAllTime?.renders ?? 0 },
      ]
    }
    const series = sliceLast(data.contentSeries ?? [], contentPieWindow)
    let intros = 0
    let products = 0
    let renders = 0
    for (const p of series) {
      intros += p.intros
      products += p.products
      renders += p.renders
    }
    return [
      { name: 'Intros', value: intros },
      { name: 'Products', value: products },
      { name: 'Renders', value: renders },
    ]
  }, [data, contentPieWindow])

  const contentPieTotal = useMemo(
    () => contentPieData.reduce((acc, d) => acc + d.value, 0),
    [contentPieData],
  )

  // Leaderboard: client-side aggregation over the chosen window.
  const leaderboard = useMemo(() => {
    if (!data?.leaderboardSeries) return []
    const cutoff = new Date()
    cutoff.setUTCHours(0, 0, 0, 0)
    const cutoffMs = cutoff.getTime() - (leaderboardWindow - 1) * 24 * 60 * 60 * 1000
    return data.leaderboardSeries
      .map((row) => {
        let renders = 0
        let intros = 0
        let products = 0
        for (const d of row.days) {
          const ts = new Date(`${d.date}T00:00:00Z`).getTime()
          if (ts < cutoffMs) continue
          renders += d.renders
          intros += d.intros
          products += d.products
        }
        return { presenter: row.presenter, renders, intros, products }
      })
      .filter((row) => row.renders + row.intros + row.products > 0)
      .sort(
        (a, b) =>
          b.renders - a.renders ||
          b.intros + b.products - (a.intros + a.products),
      )
      .slice(0, 20)
  }, [data, leaderboardWindow])

  const filtersActive =
    filters.include.length > 0 || filters.exclude.length > 0
  const filterOptions = data?.filterOptions ?? EMPTY_FILTER_OPTIONS

  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <AdminSettingsButton active={filtersActive} onClick={() => setFiltersOpen(true)} />
      {filtersOpen && (
        <AdminFiltersModal
          filters={filters}
          onChange={setFilters}
          options={filterOptions}
          enabledKinds={USAGE_FILTER_KINDS}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      <div className="w-full max-w-5xl space-y-6">
        <div className="grid grid-cols-3 items-start">
          <div className="col-start-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Usage Statistics
            </h1>
            <h3 className="mt-1 text-muted">How VLAD is being used internally.</h3>
          </div>
          <Link
            href="/admin"
            className="col-start-3 mt-1 justify-self-end text-sm text-muted hover:text-foreground"
          >
            ← Admin tools
          </Link>
        </div>

        {error && (
          <Card>
            <p className="text-sm text-red-500">{error}</p>
          </Card>
        )}

        {loading && !data && (
          <Card>
            <p className="text-sm text-muted">Loading…</p>
          </Card>
        )}

        {data && (
          <>
            {/* Card 1a + 1b: Active-users bar chart (with its own window control)
                next to a square user-counts quad — separating the two means
                the window control isn't visually attached to the rolling
                DAU/WAU/MAU/all-time stats, which are window-independent. */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <Card className="md:col-span-2">
                <CardHeader
                  title="Active users"
                  controls={
                    <SegmentedControl
                      options={WINDOW_OPTIONS}
                      value={dauWindow}
                      onChange={setDauWindow}
                    />
                  }
                />
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={dauChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                      <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="returning"
                        stackId="dau"
                        fill={COLOR_DAU}
                        name="Returning"
                        cursor="pointer"
                        onClick={(payload: unknown) => openDauDetail(payload as { rawDate: string; returningEmails: string[]; newEmails: string[] })}
                      />
                      <Bar
                        dataKey="newUsers"
                        stackId="dau"
                        fill={COLOR_NEW}
                        name="New"
                        cursor="pointer"
                        onClick={(payload: unknown) => openDauDetail(payload as { rawDate: string; returningEmails: string[]; newEmails: string[] })}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="flex flex-col">
                <CardHeader title="User counts" />
                <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3">
                  <StatBox label="Daily" value={data.counts.dau} />
                  <StatBox label="Weekly" value={data.counts.wau} />
                  <StatBox label="Monthly" value={data.counts.mau} />
                  <StatBox label="All Time" value={data.counts.allTime} />
                </div>
              </Card>
            </div>

            {/* Card 2a + 2b: stacked daily content bar chart on the left,
                all-time content totals on the right. Same split-card pattern
                as Active users / User counts. */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <Card className="md:col-span-2">
                <CardHeader
                  title="Content created"
                  controls={
                    <SegmentedControl
                      options={WINDOW_OPTIONS}
                      value={contentWindow}
                      onChange={setContentWindow}
                    />
                  }
                />
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={contentChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                      <YAxis stroke="var(--muted)" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="renders" stackId="content" fill={COLOR_RENDER} name="Renders" />
                      <Bar dataKey="products" stackId="content" fill={COLOR_PRODUCT} name="Products" />
                      <Bar dataKey="intros" stackId="content" fill={COLOR_INTRO} name="Intros" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="flex flex-col">
                <CardHeader
                  title="Content breakdown"
                  controls={
                    <SegmentedControl
                      options={PIE_WINDOW_OPTIONS}
                      value={contentPieWindow}
                      onChange={setContentPieWindow}
                    />
                  }
                />
                <div className="h-64">
                  <div className="relative isolate h-48">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                      <PieChart>
                        <Pie
                          data={contentPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="55%"
                          outerRadius="80%"
                          stroke="var(--surface)"
                        >
                          <Cell fill={COLOR_INTRO} />
                          <Cell fill={COLOR_PRODUCT} />
                          <Cell fill={COLOR_RENDER} />
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <PieCenterTotal value={contentPieTotal} />
                  </div>
                  <PieLegend
                    entries={contentPieData.map((d, i) => ({
                      name: d.name,
                      value: d.value,
                      color: [COLOR_INTRO, COLOR_PRODUCT, COLOR_RENDER][i] ?? COLOR_DAU,
                    }))}
                  />
                </div>
              </Card>
            </div>

            {/* Card 3: render success rate */}
            <Card>
              <CardHeader
                title="Render success rate"
                controls={
                  <SegmentedControl
                    options={WINDOW_OPTIONS}
                    value={successWindow}
                    onChange={setSuccessWindow}
                  />
                }
              />
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={successChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={11}
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '—')}
                    />
                    <Bar dataKey="successPct" fill={COLOR_OK} name="Success rate" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Card 5: efficiency ratio */}
            <Card>
              <CardHeader
                title="Avg render time ÷ video length"
                controls={
                  <SegmentedControl
                    options={WINDOW_OPTIONS}
                    value={efficiencyWindow}
                    onChange={setEfficiencyWindow}
                  />
                }
              />
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={efficiencyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={11}
                      tickFormatter={(v: number) => `${v.toFixed(1)}×`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}×` : '—')}
                    />
                    <Bar dataKey="ratio" fill={COLOR_RATIO} name="Render seconds per output second" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Lower is faster. Backfilled renders show as gaps — only new renders log timing.
              </p>
            </Card>

            {/* Card 4a + 4b: leaderboard with a render-by-product pie next to it */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <Card className="md:col-span-2">
                <CardHeader
                  title="Top presenters by renders"
                  controls={
                    <SegmentedControl
                      options={WINDOW_OPTIONS}
                      value={leaderboardWindow}
                      onChange={setLeaderboardWindow}
                    />
                  }
                />
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted">No renders in this window.</p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface text-xs uppercase text-muted">
                        <tr>
                          <th className="w-10 px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">Presenter</th>
                          <th className="px-3 py-2 text-right font-medium">Renders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((row, i) => (
                          <tr key={row.presenter.email} className="border-t border-border">
                            <td className="px-3 py-2 text-muted tabular-nums">{i + 1}</td>
                            <td className="px-3 py-2">
                              <div className="text-foreground">{presenterLabel(row.presenter)}</div>
                              <div className="text-xs text-muted">
                                {row.intros} intro{row.intros === 1 ? '' : 's'} · {row.products} product
                                {row.products === 1 ? '' : 's'}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-foreground tabular-nums">
                              {row.renders}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card className="flex flex-col">
                <CardHeader
                  title="Renders by product"
                  controls={
                    <SegmentedControl
                      options={PIE_WINDOW_OPTIONS}
                      value={productWindow}
                      onChange={setProductWindow}
                    />
                  }
                />
                {productBreakdown.length === 0 ? (
                  <p className="text-sm text-muted">No renders in this window.</p>
                ) : (
                  <div className="h-64">
                    <div className="relative isolate h-48">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <PieChart>
                          <Pie
                            data={productBreakdown}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="55%"
                            outerRadius="80%"
                            stroke="var(--surface)"
                          >
                            {productBreakdown.map((row) => (
                              <Cell key={row.name} fill={productColor(row.name)} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                      <PieCenterTotal value={productPieTotal} />
                    </div>
                    <PieLegend
                      entries={productBreakdown.map((row) => ({
                        name: row.name,
                        value: row.value,
                        color: productColor(row.name),
                      }))}
                    />
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>

      {dauDetail && (
        <Modal
          title={`Active users — ${shortDate(dauDetail.rawDate)}`}
          onClose={() => setDauDetail(null)}
          size="md"
        >
          <div className="space-y-5">
            <DauDetailSection
              label="New"
              users={dauDetail.newUsers}
              dotColor={COLOR_NEW}
            />
            <DauDetailSection
              label="Returning"
              users={dauDetail.returning}
              dotColor={COLOR_DAU}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function DauDetailSection({
  label,
  users,
  dotColor,
}: {
  label: string
  users: AdminUser[]
  dotColor: string
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: dotColor }}
        />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {label} <span className="ml-1 tabular-nums text-foreground">{users.length}</span>
        </h3>
      </div>
      {users.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="space-y-1.5">
          {users.map((u) => {
            const name = `${u.firstName} ${u.lastName}`.trim()
            const display = name || u.email
            return (
              <li key={u.email} className="text-sm text-foreground">
                {display}
                {name && (
                  <span className="ml-2 text-xs text-muted">{u.email}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
