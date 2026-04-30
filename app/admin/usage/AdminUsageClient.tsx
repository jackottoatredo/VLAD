'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Modal from '@/app/components/Modal'
import UsageSettingsModal from './UsageSettingsModal'
import type { AdminUser } from '@/app/api/admin/users/route'
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

type WindowDays = 7 | 30 | 90

const COLOR_DAU = '#3b82f6'      // blue (returning)
const COLOR_NEW = '#10b981'      // emerald (first-time)
const COLOR_INTRO = '#3b82f6'    // blue
const COLOR_PRODUCT = '#10b981'  // emerald
const COLOR_RENDER = '#8b5cf6'   // violet
const COLOR_OK = '#10b981'       // emerald
const COLOR_RATIO = '#f59e0b'    // amber

// Pie palette for the product breakdown — picked to be distinct in light + dark.
const PRODUCT_PIE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#6b7280', // grey (for "Other")
]

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--foreground)',
  fontSize: 12,
}

const WINDOW_OPTIONS: { value: WindowDays; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function presenterLabel(p: { firstName: string; lastName: string; email: string }): string {
  const name = `${p.firstName} ${p.lastName}`.trim()
  return name || p.email
}

function sliceLast<T>(arr: T[], n: number): T[] {
  return arr.length > n ? arr.slice(arr.length - n) : arr
}

type SegOption<T extends string | number> = { value: T; label: string }

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={[
              'px-2.5 py-1 text-xs transition-colors',
              i > 0 ? 'border-l border-border' : '',
              active
                ? 'bg-foreground text-background'
                : 'text-muted hover:bg-background hover:text-foreground',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function CardHeader({ title, controls }: { title: string; controls?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {controls && <div className="flex items-center gap-3">{controls}</div>}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface p-6 shadow-md ${className}`}
    >
      {children}
    </section>
  )
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background p-4">
      <span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
      <span className="mt-1 text-xs uppercase tracking-wider text-muted">{label}</span>
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
  const [productWindow, setProductWindow] = useState<WindowDays>(30)

  // Settings — excluded users persist in localStorage so the admin's
  // preference survives reloads. Server-side filtered via ?excludeUsers=.
  const [excludedUsers, setExcludedUsers] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Hydration state: gate the data fetch until localStorage has been read,
  // so we don't issue a wasted fetch with an empty exclude list and then
  // a second fetch with the real one.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('vlad_usage_excluded_users')
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          setExcludedUsers(parsed.filter((v): v is string => typeof v === 'string'))
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem('vlad_usage_excluded_users', JSON.stringify(excludedUsers))
    } catch {
      /* ignore */
    }
  }, [hydrated, excludedUsers])

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = excludedUsers.length > 0
      ? `?excludeUsers=${encodeURIComponent(excludedUsers.join(','))}`
      : ''
    fetch(`/api/admin/usage${qs}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: UsageResponse | { error: string }) => {
        if (cancelled) return
        if ('error' in d) setError(d.error)
        else setData(d)
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
  }, [hydrated, excludedUsers])

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
  // keep top 5 + "Other" so the pie stays legible.
  const productBreakdown = useMemo(() => {
    if (!data?.productSeries) return [] as { name: string; value: number }[]
    const cutoff = new Date()
    cutoff.setUTCHours(0, 0, 0, 0)
    const cutoffMs = cutoff.getTime() - (productWindow - 1) * 24 * 60 * 60 * 1000
    const totals = data.productSeries
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
    if (totals.length <= 6) return totals
    const top = totals.slice(0, 5)
    const otherValue = totals.slice(5).reduce((acc, r) => acc + r.value, 0)
    return otherValue > 0 ? [...top, { name: 'Other', value: otherValue }] : top
  }, [data, productWindow])

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

  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <div className="w-full max-w-5xl space-y-6">
        <div className="grid grid-cols-3 items-start">
          <div className="col-start-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Usage Statistics
            </h1>
            <h3 className="mt-1 text-muted">How VLAD is being used internally.</h3>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="col-start-2 mt-1 justify-self-center rounded-md p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
            title="Dashboard settings"
            aria-label="Dashboard settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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
                  <ResponsiveContainer width="100%" height="100%">
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
                  <ResponsiveContainer width="100%" height="100%">
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
                <CardHeader title="All time content" />
                <div className="flex-1 min-h-[16rem]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Intros', value: data.contentTotalsAllTime?.intros ?? 0 },
                          { name: 'Products', value: data.contentTotalsAllTime?.products ?? 0 },
                          { name: 'Renders', value: data.contentTotalsAllTime?.renders ?? 0 },
                        ]}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="50%"
                        outerRadius="80%"
                        stroke="var(--surface)"
                      >
                        <Cell fill={COLOR_INTRO} />
                        <Cell fill={COLOR_PRODUCT} />
                        <Cell fill={COLOR_RENDER} />
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
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
                <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
                      options={WINDOW_OPTIONS}
                      value={productWindow}
                      onChange={setProductWindow}
                    />
                  }
                />
                {productBreakdown.length === 0 ? (
                  <p className="text-sm text-muted">No renders in this window.</p>
                ) : (
                  <div className="flex-1 min-h-[16rem]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={productBreakdown}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="50%"
                          outerRadius="80%"
                          stroke="var(--surface)"
                        >
                          {productBreakdown.map((row, i) => (
                            <Cell
                              key={row.name}
                              fill={
                                row.name === 'Other'
                                  ? PRODUCT_PIE_COLORS[PRODUCT_PIE_COLORS.length - 1]
                                  : PRODUCT_PIE_COLORS[i % (PRODUCT_PIE_COLORS.length - 1)]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>

      {settingsOpen && (
        <UsageSettingsModal
          excludedUsers={excludedUsers}
          onChange={setExcludedUsers}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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
