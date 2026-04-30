'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card, CardHeader } from '@/app/admin/_components/Card'
import { SegmentedControl } from '@/app/admin/_components/SegmentedControl'

type WindowDays = 7 | 30 | 90
type WindowAll = WindowDays | 'all'

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

function StubStatQuad() {
  // 2x2 grid of placeholder stat boxes — same shape as the User Counts
  // card on /admin/usage. Values are em-dashes until data is wired.
  const cells: { label: string; description: string }[] = [
    { label: 'Total Visits', description: 'count of all visit + visit_linked rows' },
    { label: 'Unique Visitors', description: 'count(distinct visitor_id) on visit_linked' },
    { label: 'Mobile %', description: 'share of human visits with device_type=mobile' },
    { label: 'Bot %', description: 'share of visit rows with is_bot=true' },
  ]
  return (
    <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/40 p-4 text-center"
          title={c.description}
        >
          <span className="text-2xl font-semibold text-muted tabular-nums">—</span>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-muted">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function AdminEngagementClient() {
  // Per-card window state. Controls are functional visually so design
  // refinement can preview their behavior, even though no data is wired.
  const [visitsWindow, setVisitsWindow] = useState<WindowDays>(30)
  const [countsWindow, setCountsWindow] = useState<WindowAll>('all')
  const [funnelWindow, setFunnelWindow] = useState<WindowAll>(30)
  const [unfurlWindow, setUnfurlWindow] = useState<WindowAll>('all')
  const [referrerWindow, setReferrerWindow] = useState<WindowAll>('all')
  const [dropoffWindow, setDropoffWindow] = useState<WindowAll>(30)
  const [pauseWindow, setPauseWindow] = useState<WindowAll>('all')
  const [pauseMode, setPauseMode] = useState<'normalized' | 'absolute'>('normalized')
  const [lengthWindow, setLengthWindow] = useState<WindowAll>('all')
  const [mapWindow, setMapWindow] = useState<WindowAll>('all')
  const [leaderboardWindow, setLeaderboardWindow] = useState<WindowAll>(30)

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
            <StubBody
              data="visit + visit_linked rows, daily, stacked by is_bot and device_type"
              plot="stacked daily bar chart"
              purpose="spot campaign spikes vs. baseline; quickly read the bot/unfurl noise floor"
            />
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
            <StubStatQuad />
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
          <StubBody
            data="counts of visit_linked, video_play, video_quartile (q=25/50/75), video_end, click_* events"
            plot="horizontal funnel: 7 stacked bars with absolute counts and stage-to-stage conversion %"
            purpose="answer 'is the format converting attention into action?' end-to-end"
          />
        </Card>

        {/* Row 3: Where shared — bot platforms vs. human referrers. Two
            halves of the same question; placed side-by-side at equal weight. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader
              title="Where shared — Unfurl platforms"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={unfurlWindow}
                  onChange={setUnfurlWindow}
                />
              }
            />
            <StubBody
              data="visit rows where is_bot=true, grouped by bot_kind"
              plot="donut with center total, custom legend below"
              purpose="show which platforms unfurled the link (Slack / LinkedIn / Discord / etc.) — proxies 'where it spread'"
            />
          </Card>
          <Card className="flex flex-col">
            <CardHeader
              title="Where shared — Referrer source"
              controls={
                <SegmentedControl
                  options={WINDOW_OPTIONS_ALL}
                  value={referrerWindow}
                  onChange={setReferrerWindow}
                />
              }
            />
            <StubBody
              data="visit_linked rows grouped by referrer_kind (slack / linkedin / twitter / email / direct / other)"
              plot="donut with center total, custom legend below"
              purpose="show which sources real humans came from — distinguishes message channel from unfurl channel"
            />
          </Card>
        </div>

        {/* Row 4: Watch dropoff. Within-player retention — separate question
            from the funnel above (which is page-level conversion). */}
        <Card>
          <CardHeader
            title="Watch dropoff"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={dropoffWindow}
                onChange={setDropoffWindow}
              />
            }
          />
          <StubBody
            data="video_play, video_quartile, video_end events; normalized so video_play = 100%"
            plot="5-bar histogram: play (100%), q25, q50, q75, end (each as % of plays)"
            purpose="surface where viewers bail mid-video — independent of how many viewers there were"
          />
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
          <StubBody
            data="video_pause events, payload.currentTime joined to source video duration"
            plot={
              "histogram — normalized: bin currentTime/duration into 5% buckets (0–100%); " +
              "absolute: bin currentTime into 5s buckets"
            }
            purpose="reveal content moments where viewers pause to think (or check out) — surfaces issues no other plot catches"
          />
        </Card>

        {/* Row 6: Length × completion. Cross-cut showing whether longer
            videos retain less. Single full-width chart — needs horizontal
            room for the length bins on the x-axis. */}
        <Card>
          <CardHeader
            title="Length vs. completion"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={lengthWindow}
                onChange={setLengthWindow}
              />
            }
          />
          <StubBody
            data="for each slug: video duration (10s bins) vs. fraction of plays that reached video_end"
            plot="bar chart, x = length bins (0–10s, 10–20s, …), y = completion rate (0–100%)"
            purpose="find the duration threshold beyond which retention drops — informs ideal preview length"
          />
        </Card>

        {/* Row 7: Visit map. Geo distribution of real humans. Bots excluded
            because iplocate only fires on non-bot visit events. */}
        <Card>
          <CardHeader
            title="Visit map"
            controls={
              <SegmentedControl
                options={WINDOW_OPTIONS_ALL}
                value={mapWindow}
                onChange={setMapWindow}
              />
            }
          />
          <StubBody
            data="visit rows where is_bot=false and country is not null, aggregated by country (region on hover)"
            plot="world choropleth (or bubble map) with country counts; tooltip shows region breakdown"
            purpose="see geographic distribution of engaged audience — informs market priority and campaign targeting"
            height="h-96"
          />
          <p className="mt-2 text-xs text-muted">
            Bot/unfurl traffic excluded — iplocate only resolves on real visitor IPs.
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
