'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import WebcamControls from '@/app/components/WebcamControls'
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from '@/types/webcam'
import { useAppContext } from '@/app/appContext'

const BRANDS = ['allbirds.com', 'mammut.com', 'andcollar.com', 'adidas.com'] as const
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

function BrandPanel({
  brand,
  state,
  onGenerate,
  videoRef,
}: {
  brand: Brand
  state: BrandState
  onGenerate: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
}) {
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

      <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-4 pt-3">
        {state.status === 'idle' && (
          <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <button
              onClick={onGenerate}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Generate
            </button>
          </div>
        )}

        {isWorking && (
          <div className="relative w-full aspect-video rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <div className="absolute inset-x-0 top-0 space-y-2 p-3">
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
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
            <p className="text-center text-xs text-red-500">{state.message}</p>
          </div>
        )}

        {state.status === 'done' && (
          <video ref={videoRef} src={state.videoUrl} controls className="w-full rounded-lg" />
        )}
      </div>
    </div>
  )
}

export default function PreviewPage() {
  const {
    product: productDraft,
    markProductTrimClean,
    markProductSaved,
  } = useAppContext()

  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [selectedPresenter, setSelectedPresenter] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [listError, setListError] = useState('')
  const [brandStates, setBrandStates] = useState<Record<Brand, BrandState>>(initialBrandStates)
  const [product, setProduct] = useState('')
  const [recordedSettings, setRecordedSettings] = useState<WebcamSettings>(DEFAULT_WEBCAM_SETTINGS)
  const [webcamSettings, setWebcamSettings] = useState<WebcamSettings>(DEFAULT_WEBCAM_SETTINGS)
  const [useRecordingSettings, setUseRecordingSettings] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  const videoRefs = useRef<Record<Brand, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(BRANDS.map((b) => [b, { current: null }])) as Record<Brand, React.RefObject<HTMLVideoElement | null>>
  )

  // jobId → brand for the polling interval
  const activeJobsRef = useRef<Map<string, Brand>>(new Map())

  useEffect(() => {
    fetch('/api/list-recordings')
      .then((r) => r.json())
      .then((data: { recordings: RecordingEntry[] }) => {
        setRecordings(data.recordings)
        // Prefer context values if set, otherwise pick most recent
        if (productDraft.presenter && productDraft.session) {
          setSelectedPresenter(productDraft.presenter)
          setSelectedSession(productDraft.session)
        } else if (data.recordings.length > 0) {
          setSelectedPresenter(data.recordings[0].presenter)
          setSelectedSession(data.recordings[0].name)
        }
        setIsLoadingList(false)
      })
      .catch(() => {
        setListError('Failed to load session list.')
        setIsLoadingList(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedPresenter || !selectedSession) { setProduct(''); return }
    setSaveStatus('idle')
    setSaveError('')
    fetch(`/api/session-metadata?presenter=${selectedPresenter}&session=${selectedSession}`)
      .then((r) => r.json())
      .then((data: { product?: string; webcamMode?: string; webcamVertical?: string; webcamHorizontal?: string }) => {
        setProduct(data.product ?? '')
        const loaded: WebcamSettings = {
          webcamMode: (data.webcamMode as WebcamSettings['webcamMode']) ?? DEFAULT_WEBCAM_SETTINGS.webcamMode,
          webcamVertical: (data.webcamVertical as WebcamSettings['webcamVertical']) ?? DEFAULT_WEBCAM_SETTINGS.webcamVertical,
          webcamHorizontal: (data.webcamHorizontal as WebcamSettings['webcamHorizontal']) ?? DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
        }
        setRecordedSettings(loaded)
        setWebcamSettings(loaded)
        setUseRecordingSettings(true)
      })
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

  async function generateBrand(brand: Brand) {
    setBrandStates((prev) => ({ ...prev, [brand]: { status: 'idle' } }))
    try {
      const res = await fetch('/api/render-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: selectedSession,
          presenter: selectedPresenter,
          brand,
          product,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
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
  }

  async function handleGenerate() {
    setBrandStates(initialBrandStates())
    activeJobsRef.current.clear()
    markProductTrimClean()
    await Promise.all(BRANDS.map((brand) => generateBrand(brand)))
  }

  function handlePlayAll() {
    for (const brand of BRANDS) {
      const video = videoRefs.current[brand].current
      if (video) {
        video.currentTime = 0
        video.play()
      }
    }
  }

  async function handleSave() {
    if (!selectedPresenter || !selectedSession) return
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presenter: selectedPresenter, session: selectedSession, type: 'product', productName: product }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setSaveStatus('error')
        setSaveError(data.error ?? 'Failed to save.')
      } else {
        setSaveStatus('saved')
        markProductSaved()
      }
    } catch {
      setSaveStatus('error')
      setSaveError('Unexpected error.')
    }
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

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={useRecordingSettings}
                  onChange={(e) => {
                    setUseRecordingSettings(e.target.checked)
                    if (e.target.checked) setWebcamSettings(recordedSettings)
                  }}
                  disabled={isAnyActive}
                  className="rounded border-zinc-300 dark:border-zinc-700"
                />
                Use recording settings
              </label>
              {!useRecordingSettings && (
                <WebcamControls
                  settings={webcamSettings}
                  onChange={setWebcamSettings}
                  disabled={isAnyActive}
                />
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isAnyActive ? 'Generating…' : 'Generate All Previews'}
            </button>

            {BRANDS.every((b) => brandStates[b].status === 'done') && (
              <>
                <button
                  onClick={handlePlayAll}
                  className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Play All
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving' || saveStatus === 'saved'}
                  className="w-full rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:opacity-50"
                >
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved to Library' : 'Save to Library'}
                </button>
                {saveStatus === 'saved' && (
                  <p className="text-xs text-green-600 dark:text-green-400">Recording saved successfully.</p>
                )}
                {saveStatus === 'error' && (
                  <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
                )}
              </>
            )}

            {listError && <p className="text-xs text-red-600 dark:text-red-400">{listError}</p>}
          </>
        }
      >
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
          {BRANDS.map((brand) => (
            <BrandPanel
              key={brand}
              brand={brand}
              state={brandStates[brand]}
              onGenerate={() => generateBrand(brand)}
              videoRef={videoRefs.current[brand]}
            />
          ))}
        </div>
      </PageLayout>
      <PageNav
        back={{ label: 'Postprocessing', href: '/postprocess' }}
        forward={{ label: 'Merchant Customization', href: '/merchant' }}
      />

    </>
  )
}
