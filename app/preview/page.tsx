'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import WebcamControls from '@/app/components/WebcamControls'
import { type WebcamSettings } from '@/types/webcam'
import { useAppContext, type BrandArtifacts } from '@/app/appContext'

const BRANDS = ['allbirds.com', 'mammut.com', 'andcollar.com', 'adidas.com'] as const
type Brand = (typeof BRANDS)[number]
const JOB_POLL_INTERVAL_MS = 500

type BrandState =
  | { status: 'idle' }
  | { status: 'rendering'; jobId: string; rendered: number; total: number }
  | { status: 'compositing'; jobId: string; composited: number; total: number }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }

function initialBrandStates(): Record<Brand, BrandState> {
  return Object.fromEntries(BRANDS.map((b) => [b, { status: 'idle' }])) as Record<Brand, BrandState>
}

function BrandPanel({
  brand, state, onGenerate, videoRef,
}: {
  brand: Brand; state: BrandState; onGenerate: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const renderProgress =
    state.status === 'rendering' && state.total > 0
      ? Math.round((state.rendered / state.total) * 100)
      : state.status === 'compositing' || state.status === 'done' ? 100 : 0
  const composeProgress =
    state.status === 'compositing' && state.total > 0
      ? Math.round((state.composited / state.total) * 100)
      : state.status === 'done' ? 100 : 0
  const isWorking = state.status === 'rendering' || state.status === 'compositing'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50 dark:border-white/10 dark:bg-zinc-900">
      <p className="shrink-0 px-4 pt-4 pb-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">{brand}</p>
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-4 pt-3">
        {state.status === 'idle' && (
          <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <button onClick={onGenerate} className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Generate</button>
          </div>
        )}
        {isWorking && (
          <div className="relative w-full aspect-video rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <div className="absolute inset-x-0 top-0 space-y-2 p-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{state.status === 'rendering' ? (state.total > 0 ? `Rendering — frame ${state.rendered} of ${state.total}` : 'Rendering — starting…') : 'Rendering — complete'}</span>
                  <span>{renderProgress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100" style={{ width: `${renderProgress}%` }} /></div>
              </div>
              {state.status === 'compositing' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400"><span>{state.total > 0 ? `Compositing — step ${state.composited} of ${state.total}` : 'Compositing — starting…'}</span><span>{composeProgress}%</span></div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100" style={{ width: `${composeProgress}%` }} /></div>
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
    setProductPreviewCache,
    markProductSaved,
  } = useAppContext()

  const { presenter, session, product, webcamSettings, trimStartSec, trimEndSec, previewCache, savedToLibrary } = productDraft

  const [brandStates, setBrandStates] = useState<Record<Brand, BrandState>>(initialBrandStates)
  const [useRecordingSettings, setUseRecordingSettings] = useState(true)
  const [overrideSettings, setOverrideSettings] = useState<WebcamSettings>(webcamSettings)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  const activeSettings = useRecordingSettings ? webcamSettings : overrideSettings

  const videoRefs = useRef<Record<Brand, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(BRANDS.map((b) => [b, { current: null }])) as Record<Brand, React.RefObject<HTMLVideoElement | null>>
  )
  const activeJobsRef = useRef<Map<string, Brand>>(new Map())
  const brandArtifactsRef = useRef<Record<string, BrandArtifacts>>({})

  // Check if we have cached composite artifacts for warm-start (from a previous full render)
  const hasBrandArtifacts = !!(
    previewCache &&
    previewCache.sessionKey === `${presenter}/${session}` &&
    previewCache.webcamSettings.webcamMode === activeSettings.webcamMode &&
    previewCache.webcamSettings.webcamVertical === activeSettings.webcamVertical &&
    previewCache.webcamSettings.webcamHorizontal === activeSettings.webcamHorizontal &&
    Object.keys(previewCache.brandArtifacts ?? {}).length > 0
  )

  // Derive cache validity — no effect needed, purely reactive
  const cacheValid = !!(
    previewCache &&
    previewCache.sessionKey === `${presenter}/${session}` &&
    previewCache.trimStartSec === trimStartSec &&
    previewCache.trimEndSec === trimEndSec &&
    previewCache.webcamSettings.webcamMode === activeSettings.webcamMode &&
    previewCache.webcamSettings.webcamVertical === activeSettings.webcamVertical &&
    previewCache.webcamSettings.webcamHorizontal === activeSettings.webcamHorizontal
  )

  // Restore brand states from cache or reset when inputs change
  useEffect(() => {
    setSaveStatus(savedToLibrary ? 'saved' : 'idle')
    setSaveError('')
    if (cacheValid && previewCache) {
      const restored = { ...initialBrandStates() }
      for (const [brand, url] of Object.entries(previewCache.brandVideos)) {
        if (brand in restored) {
          (restored as Record<string, BrandState>)[brand] = { status: 'done', videoUrl: url }
        }
      }
      setBrandStates(restored)
      brandArtifactsRef.current = { ...(previewCache.brandArtifacts ?? {}) }
    } else {
      setBrandStates(initialBrandStates())
      activeJobsRef.current.clear()
      // Seed artifacts from cache even if videos are stale (trim changed) — composites are still valid
      const artifacts = previewCache?.brandArtifacts ?? {}
      if (Object.keys(artifacts).length > 0) {
        brandArtifactsRef.current = { ...artifacts }
      }
    }
  }, [cacheValid, previewCache, savedToLibrary])

  // Poll for job progress
  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return
      await Promise.all(
        jobs.map(async ([jobId, brand]) => {
          try {
            const res = await fetch(`/api/render-progress/${jobId}`)
            const job = (await res.json()) as {
              status: string; rendered?: number; total?: number; composited?: number;
              videoUrl?: string; message?: string;
              renderUrl?: string; renderPath?: string; renderDurationMs?: number;
              compositeUrl?: string; compositePath?: string;
            }
            if (job.status === 'done' && job.videoUrl) {
              activeJobsRef.current.delete(jobId)
              if (job.compositeUrl && job.compositePath) {
                brandArtifactsRef.current[brand] = {
                  compositeUrl: job.compositeUrl,
                  compositePath: job.compositePath,
                  renderUrl: job.renderUrl ?? '',
                  renderPath: job.renderPath ?? '',
                  renderDurationMs: job.renderDurationMs ?? 0,
                }
              }
              setBrandStates((prev) => ({ ...prev, [brand]: { status: 'done', videoUrl: job.videoUrl! } }))
            } else if (job.status === 'error') {
              activeJobsRef.current.delete(jobId)
              setBrandStates((prev) => ({ ...prev, [brand]: { status: 'error', message: job.message ?? 'Render failed.' } }))
            } else if (job.status === 'rendering') {
              setBrandStates((prev) => { const cur = prev[brand]; if (cur.status !== 'rendering') return prev; return { ...prev, [brand]: { ...cur, rendered: job.rendered ?? 0, total: job.total ?? 0 } } })
            } else if (job.status === 'compositing') {
              setBrandStates((prev) => ({ ...prev, [brand]: { status: 'compositing', jobId, composited: job.composited ?? 0, total: job.total ?? 0 } }))
            }
          } catch { /* transient */ }
        })
      )
    }, JOB_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // When all brands are done and cache doesn't already match, save to context
  const activeSettingsRef = useRef(activeSettings)
  activeSettingsRef.current = activeSettings

  useEffect(() => {
    if (cacheValid) return
    const allBrandsDone = BRANDS.every((b) => brandStates[b].status === 'done')
    if (!allBrandsDone) return
    const brandVideos: Record<string, string> = {}
    for (const b of BRANDS) {
      const s = brandStates[b]
      if (s.status === 'done') brandVideos[b] = s.videoUrl
    }
    setProductPreviewCache(brandVideos, activeSettingsRef.current, { ...brandArtifactsRef.current })
  }, [brandStates, cacheValid, setProductPreviewCache])

  async function generateBrand(brand: Brand) {
    // Check if we have cached composite artifacts for this brand (trim-only re-run)
    const cached = hasBrandArtifacts ? previewCache?.brandArtifacts[brand] : undefined
    const startFromStep = cached ? 3 : 1

    if (startFromStep === 3) {
      setBrandStates((prev) => ({ ...prev, [brand]: { status: 'compositing', jobId: '', composited: 0, total: 0 } }))
    } else {
      setBrandStates((prev) => ({ ...prev, [brand]: { status: 'idle' } }))
    }

    const bodyObj: Record<string, unknown> = {
      session, presenter, brand, product,
      webcamMode: activeSettings.webcamMode,
      webcamVertical: activeSettings.webcamVertical,
      webcamHorizontal: activeSettings.webcamHorizontal,
      trimStartSec, trimEndSec,
      startFromStep,
    }

    if (cached) {
      bodyObj.existingRenderPath = cached.renderPath
      bodyObj.existingRenderUrl = cached.renderUrl
      bodyObj.existingRenderDurationMs = cached.renderDurationMs
      bodyObj.existingCompositePath = cached.compositePath
      bodyObj.existingCompositeUrl = cached.compositeUrl
    }

    try {
      const res = await fetch('/api/render-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      })
      const payload = (await res.json()) as { jobId?: string; error?: string }
      if (res.status === 404 && cached) {
        // Cached file deleted — fall back to full render
        return generateBrandFull(brand)
      }
      if (!res.ok || !payload.jobId) {
        setBrandStates((prev) => ({ ...prev, [brand]: { status: 'error', message: payload.error ?? 'Failed to start render.' } }))
        return
      }
      activeJobsRef.current.set(payload.jobId, brand)
      if (startFromStep < 3) {
        setBrandStates((prev) => ({ ...prev, [brand]: { status: 'rendering', jobId: payload.jobId!, rendered: 0, total: 0 } }))
      }
    } catch {
      setBrandStates((prev) => ({ ...prev, [brand]: { status: 'error', message: 'Unexpected error.' } }))
    }
  }

  async function generateBrandFull(brand: Brand) {
    setBrandStates((prev) => ({ ...prev, [brand]: { status: 'idle' } }))
    try {
      const res = await fetch('/api/render-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session, presenter, brand, product,
          webcamMode: activeSettings.webcamMode,
          webcamVertical: activeSettings.webcamVertical,
          webcamHorizontal: activeSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
          startFromStep: 1,
        }),
      })
      const payload = (await res.json()) as { jobId?: string; error?: string }
      if (!res.ok || !payload.jobId) {
        setBrandStates((prev) => ({ ...prev, [brand]: { status: 'error', message: payload.error ?? 'Failed to start render.' } }))
        return
      }
      activeJobsRef.current.set(payload.jobId, brand)
      setBrandStates((prev) => ({ ...prev, [brand]: { status: 'rendering', jobId: payload.jobId!, rendered: 0, total: 0 } }))
    } catch {
      setBrandStates((prev) => ({ ...prev, [brand]: { status: 'error', message: 'Unexpected error.' } }))
    }
  }

  async function handleGenerate() {
    setBrandStates(initialBrandStates())
    activeJobsRef.current.clear()
    // If not doing warm-start, clear accumulated artifacts
    if (!hasBrandArtifacts) {
      brandArtifactsRef.current = {}
    }
    await Promise.all(BRANDS.map((brand) => generateBrand(brand)))
  }

  function handlePlayAll() {
    for (const brand of BRANDS) {
      const video = videoRefs.current[brand].current
      if (video) { video.currentTime = 0; video.play() }
    }
  }

  async function handleSave() {
    if (!presenter || !session) return
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, session, type: 'product', productName: product,
          metadata: {
            trimStartSec, trimEndSec,
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
          },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setSaveStatus('error'); setSaveError(data.error ?? 'Failed to save.') }
      else { setSaveStatus('saved'); markProductSaved() }
    } catch { setSaveStatus('error'); setSaveError('Unexpected error.') }
  }

  const isAnyActive = BRANDS.some((b) => { const s = brandStates[b]; return s.status === 'rendering' || s.status === 'compositing' })
  const allDone = BRANDS.every((b) => brandStates[b].status === 'done')
  const canGenerate = !isAnyActive && !!presenter && !!session

  return (
    <>
      <PageLayout
        instructions={<p>Preview your recording rendered across multiple brands. Adjust trim on the Postprocessing page if needed.</p>}
        settings={
          <>
            <div className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {presenter && session ? <span>{session}</span> : <span className="text-zinc-400">No recording selected</span>}
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={useRecordingSettings} onChange={(e) => { setUseRecordingSettings(e.target.checked); if (e.target.checked) setOverrideSettings(webcamSettings) }} disabled={isAnyActive} className="rounded border-zinc-300 dark:border-zinc-700" />
                Use recording settings
              </label>
              {!useRecordingSettings && (
                <WebcamControls settings={overrideSettings} onChange={setOverrideSettings} disabled={isAnyActive} />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <button onClick={handleGenerate} disabled={!canGenerate} className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                {isAnyActive ? 'Generating…' : hasBrandArtifacts ? 'Retrim All Previews' : 'Generate All Previews'}
              </button>
              {hasBrandArtifacts && !isAnyActive && (
                <p className="text-xs text-zinc-400">Retrim only — skipping render + composite</p>
              )}
            </div>

            {allDone && (
              <>
                <button onClick={handlePlayAll} className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Play All</button>
                <button onClick={handleSave} disabled={saveStatus === 'saving' || saveStatus === 'saved'} className="w-full rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:opacity-50">
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved to Library' : 'Save to Library'}
                </button>
                {saveStatus === 'saved' && <p className="text-xs text-green-600 dark:text-green-400">Recording saved successfully.</p>}
                {saveStatus === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
              </>
            )}
          </>
        }
      >
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
          {BRANDS.map((brand) => (
            <BrandPanel key={brand} brand={brand} state={brandStates[brand]} onGenerate={() => generateBrand(brand)} videoRef={videoRefs.current[brand]} />
          ))}
        </div>
      </PageLayout>
      <PageNav back={{ label: 'Postprocessing', href: '/postprocess' }} forward={{ label: 'Merchant Customization', href: '/merchant' }} />
    </>
  )
}
