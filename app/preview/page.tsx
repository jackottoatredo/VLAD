'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'

const BRANDS = ['allbirds.com', 'mammut.com', '&collar.com', 'nike.com'] as const
type Brand = (typeof BRANDS)[number]
const JOB_POLL_INTERVAL_MS = 500

type BrandState =
  | { status: 'idle' }
  | { status: 'rendering'; jobId: string; rendered: number; total: number }
  | { status: 'compositing'; jobId: string; composited: number; total: number }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }

type RecordingEntry = { name: string; presenter: string; recordedAt: string }

function initialBrandStates(): Record<Brand, BrandState> {
  return Object.fromEntries(BRANDS.map((b) => [b, { status: 'idle' }])) as Record<Brand, BrandState>
}

function BrandPanel({ brand, state }: { brand: Brand; state: BrandState }) {
  const renderProgress =
    state.status === 'rendering' && state.total > 0
      ? Math.round((state.rendered / state.total) * 100)
      : state.status === 'compositing' || state.status === 'done'
      ? 100
      : 0

  const composeProgress =
    state.status === 'compositing' && state.total > 0
      ? Math.round((state.composited / state.total) * 100)
      : state.status === 'done'
      ? 100
      : 0

  const isWorking = state.status === 'rendering' || state.status === 'compositing'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50 dark:border-white/10 dark:bg-zinc-900">
      <p className="shrink-0 px-4 pt-4 pb-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">{brand}</p>

      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 p-4 pt-3">
        {(state.status === 'idle' || isWorking) && (
          <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <svg
              className={`h-8 w-8 text-zinc-300 dark:text-zinc-600 ${isWorking ? 'animate-spin' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}

        {isWorking && (
          <div className="w-full space-y-2">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {state.status === 'rendering'
                    ? state.total > 0
                      ? `Rendering — frame ${state.rendered} of ${state.total}`
                      : 'Rendering — starting…'
                    : 'Rendering — complete'}
                </span>
                <span>{renderProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                  style={{ width: `${renderProgress}%` }}
                />
              </div>
            </div>

            {state.status === 'compositing' && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    {state.total > 0
                      ? `Compositing — step ${state.composited} of ${state.total}`
                      : 'Compositing — starting…'}
                  </span>
                  <span>{composeProgress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                    style={{ width: `${composeProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
            <p className="text-center text-xs text-red-500">{state.message}</p>
          </div>
        )}

        {state.status === 'done' && (
          <video src={state.videoUrl} controls className="w-full rounded-lg" />
        )}
      </div>
    </div>
  )
}

export default function PreviewPage() {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [selectedPresenter, setSelectedPresenter] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [listError, setListError] = useState('')
  const [brandStates, setBrandStates] = useState<Record<Brand, BrandState>>(initialBrandStates)
  const [product, setProduct] = useState('')

  // jobId → brand for the polling interval
  const activeJobsRef = useRef<Map<string, Brand>>(new Map())

  useEffect(() => {
    fetch('/api/list-recordings')
      .then((r) => r.json())
      .then((data: { recordings: RecordingEntry[] }) => {
        setRecordings(data.recordings)
        if (data.recordings.length > 0) {
          setSelectedPresenter(data.recordings[0].presenter)
          setSelectedSession(data.recordings[0].name)
        }
        setIsLoadingList(false)
      })
      .catch(() => {
        setListError('Failed to load session list.')
        setIsLoadingList(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedPresenter || !selectedSession) { setProduct(''); return }
    fetch(`/api/session-metadata?presenter=${selectedPresenter}&session=${selectedSession}`)
      .then((r) => r.json())
      .then((data: { product?: string }) => setProduct(data.product ?? ''))
      .catch(() => setProduct(''))
  }, [selectedPresenter, selectedSession])

  // Single persistent polling interval — reads activeJobsRef so no deps needed
  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return

      await Promise.all(
        jobs.map(async ([jobId, brand]) => {
          try {
            const res = await fetch(`/api/render-progress/${jobId}`)
            const job = (await res.json()) as {
              status: string
              rendered?: number
              total?: number
              composited?: number
              videoUrl?: string
              message?: string
            }

            if (job.status === 'done' && job.videoUrl) {
              activeJobsRef.current.delete(jobId)
              setBrandStates((prev) => ({ ...prev, [brand]: { status: 'done', videoUrl: job.videoUrl! } }))
            } else if (job.status === 'error') {
              activeJobsRef.current.delete(jobId)
              setBrandStates((prev) => ({
                ...prev,
                [brand]: { status: 'error', message: job.message ?? 'Render failed.' },
              }))
            } else if (job.status === 'rendering') {
              setBrandStates((prev) => {
                const cur = prev[brand]
                if (cur.status !== 'rendering') return prev
                return { ...prev, [brand]: { ...cur, rendered: job.rendered ?? 0, total: job.total ?? 0 } }
              })
            } else if (job.status === 'compositing') {
              setBrandStates((prev) => ({
                ...prev,
                [brand]: {
                  status: 'compositing',
                  jobId,
                  composited: job.composited ?? 0,
                  total: job.total ?? 0,
                },
              }))
            }
          } catch {
            // transient fetch error — keep polling
          }
        })
      )
    }, JOB_POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  async function handleGenerate() {
    setBrandStates(initialBrandStates())
    activeJobsRef.current.clear()

    await Promise.all(
      BRANDS.map(async (brand) => {
        try {
          const res = await fetch('/api/render-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session: selectedSession,
              presenter: selectedPresenter,
              brand,
              product,
            }),
          })
          const payload = (await res.json()) as { jobId?: string; error?: string }

          if (!res.ok || !payload.jobId) {
            setBrandStates((prev) => ({
              ...prev,
              [brand]: { status: 'error', message: payload.error ?? 'Failed to start render.' },
            }))
            return
          }

          activeJobsRef.current.set(payload.jobId, brand)
          setBrandStates((prev) => ({
            ...prev,
            [brand]: { status: 'rendering', jobId: payload.jobId!, rendered: 0, total: 0 },
          }))
        } catch {
          setBrandStates((prev) => ({
            ...prev,
            [brand]: { status: 'error', message: 'Unexpected error.' },
          }))
        }
      })
    )
  }

  const isAnyActive = BRANDS.some((b) => {
    const s = brandStates[b]
    return s.status === 'rendering' || s.status === 'compositing'
  })
  const canGenerate = !isLoadingList && !isAnyActive && !!selectedPresenter && !!selectedSession

  const presenters = [...new Set(recordings.map((r) => r.presenter))].sort()
  const sessionsForPresenter = recordings
    .filter((r) => r.presenter === selectedPresenter)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))

  return (
    <>
      <PageLayout
        instructions={
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
        }
        settings={
          <>
            <select
              value={selectedPresenter}
              onChange={(e) => {
                const presenter = e.target.value
                setSelectedPresenter(presenter)
                const first = recordings.find((r) => r.presenter === presenter)
                setSelectedSession(first?.name ?? '')
              }}
              disabled={isLoadingList || isAnyActive}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {isLoadingList && <option value="">Loading…</option>}
              {!isLoadingList && presenters.length === 0 && <option value="">No presenters yet</option>}
              {presenters.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              disabled={isLoadingList || isAnyActive || sessionsForPresenter.length === 0}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {sessionsForPresenter.length === 0 && <option value="">No sessions</option>}
              {sessionsForPresenter.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {new Date(r.recordedAt).toLocaleString()}
                </option>
              ))}
            </select>

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isAnyActive ? 'Generating…' : 'Generate Previews'}
            </button>

            {listError && <p className="text-xs text-red-600 dark:text-red-400">{listError}</p>}
          </>
        }
      >
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
          {BRANDS.map((brand) => (
            <BrandPanel key={brand} brand={brand} state={brandStates[brand]} />
          ))}
        </div>
      </PageLayout>
      <PageNav
        back={{ label: 'Product Recording', href: '/record' }}
        forward={{ label: 'Merchant Customization', href: '/merchant' }}
      />
    </>
  )
}
