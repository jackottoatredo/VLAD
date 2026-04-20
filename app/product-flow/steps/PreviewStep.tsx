'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaPlayer from '@/app/components/MediaPlayer'
import { TARGET_URL } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productPreview } from '@/app/copy/instructions'

const BRANDS = ['allbirds.com', 'mammut.com', 'andcollar.com', 'adidas.com'] as const
type Brand = (typeof BRANDS)[number]
const POLL_MS = 500

type BrandJob = {
  videoUrl: string | null
  loading: Array<{ label: string; progress: number }> | null
  error: string | null
}

function initialBrandJobs(): Record<Brand, BrandJob> {
  return Object.fromEntries(BRANDS.map((b) => [b, { videoUrl: null, loading: null, error: null }])) as Record<Brand, BrandJob>
}

type Props = {
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function PreviewStep({ navBack, navForward }: Props) {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const { product, webcamSettings, trimStartSec, trimEndSec, brandVideoUrls, postprocessVideoUrl } = flow

  const [brandJobs, setBrandJobs] = useState<Record<Brand, BrandJob>>(() => {
    const initial = initialBrandJobs()
    for (const b of BRANDS) {
      if (brandVideoUrls[b]) initial[b] = { videoUrl: brandVideoUrls[b], loading: null, error: null }
    }
    return initial
  })

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  const videoRefs = useRef<Record<Brand, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(BRANDS.map((b) => [b, { current: null }])) as Record<Brand, React.RefObject<HTMLVideoElement | null>>
  )
  const activeJobsRef = useRef<Map<string, Brand>>(new Map())
  const didAutoGenerate = useRef(false)

  // Polling
  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return
      await Promise.all(
        jobs.map(async ([jobId, brand]) => {
          try {
            const res = await fetch(`/api/render-progress/${jobId}`)
            const job = (await res.json()) as { status: string; rendered?: number; total?: number; composited?: number; videoUrl?: string; message?: string }
            if (job.status === 'done' && job.videoUrl) {
              activeJobsRef.current.delete(jobId)
              flow.setBrandVideoUrl(brand, job.videoUrl)
              setBrandJobs((prev) => ({ ...prev, [brand]: { videoUrl: job.videoUrl!, loading: null, error: null } }))
            } else if (job.status === 'error') {
              activeJobsRef.current.delete(jobId)
              setBrandJobs((prev) => ({ ...prev, [brand]: { videoUrl: null, loading: null, error: job.message ?? 'Failed.' } }))
            } else if (job.status === 'rendering') {
              const pct = job.total && job.total > 0 ? (job.rendered ?? 0) / job.total * 100 : 0
              setBrandJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: [{ label: 'Rendering', progress: pct }, { label: 'Compositing', progress: 0 }, { label: 'Clipping', progress: 0 }] } }))
            } else if (job.status === 'compositing') {
              const pct = job.total && job.total > 0 ? (job.composited ?? 0) / job.total * 100 : 0
              setBrandJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: [{ label: 'Rendering', progress: 100 }, { label: 'Compositing', progress: pct }, { label: 'Clipping', progress: 0 }] } }))
            }
          } catch { /* transient */ }
        })
      )
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [flow])

  // Auto-generate on mount if no cached videos
  useEffect(() => {
    if (didAutoGenerate.current || !presenter || !product) return
    const allCached = BRANDS.every((b) => !!brandVideoUrls[b])
    if (allCached) return
    didAutoGenerate.current = true
    generateAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, product])

  async function generateBrand(brand: Brand) {
    setBrandJobs((prev) => ({
      ...prev,
      [brand]: { videoUrl: null, loading: [{ label: 'Rendering', progress: 0 }, { label: 'Compositing', progress: 0 }, { label: 'Clipping', progress: 0 }], error: null },
    }))
    const url = `${TARGET_URL}?product=${encodeURIComponent(product)}&brand=${encodeURIComponent(brand)}`
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, product, url,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
        }),
      })
      const data = (await res.json()) as { jobId?: string; videoUrl?: string; error?: string }
      if (data.videoUrl) {
        flow.setBrandVideoUrl(brand, data.videoUrl)
        setBrandJobs((prev) => ({ ...prev, [brand]: { videoUrl: data.videoUrl!, loading: null, error: null } }))
        return
      }
      if (!res.ok || !data.jobId) {
        setBrandJobs((prev) => ({ ...prev, [brand]: { videoUrl: null, loading: null, error: data.error ?? 'Failed.' } }))
        return
      }
      activeJobsRef.current.set(data.jobId, brand)
    } catch {
      setBrandJobs((prev) => ({ ...prev, [brand]: { videoUrl: null, loading: null, error: 'Unexpected error.' } }))
    }
  }

  async function generateAll() {
    activeJobsRef.current.clear()
    await Promise.all(BRANDS.map(generateBrand))
  }

  function handlePlayAll() {
    for (const brand of BRANDS) {
      const v = videoRefs.current[brand].current
      if (v) { v.currentTime = 0; v.play() }
    }
  }

  async function handleSave() {
    if (!presenter || !product) return
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, session: `${presenter}_${product}`, type: 'product', productName: product,
          previewVideoR2Key: flow.postprocessVideoR2Key,
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
      else { setSaveStatus('saved'); flow.markSaved(); flow.setStep(3) }
    } catch { setSaveStatus('error'); setSaveError('Unexpected error.') }
  }

  const allDone = BRANDS.every((b) => !!brandJobs[b].videoUrl)
  const isAnyLoading = BRANDS.some((b) => !!brandJobs[b].loading)

  return (
    <PageLayout
      navBack={navBack}
      navForward={navForward}
      instructions={<Markdown>{productPreview}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <button
            onClick={handlePlayAll}
            disabled={!allDone}
            className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Play All
          </button>
          <button
            onClick={handleSave}
            disabled={!allDone || saveStatus === 'saving' || saveStatus === 'saved'}
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
          {saveStatus === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
        </div>
      }
    >
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
        {BRANDS.map((brand) => {
          const bj = brandJobs[brand]
          return (
            <div key={brand} className="flex flex-col rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {brand}
              </p>
              <div className="flex flex-1 items-center justify-center">
                <MediaPlayer
                  videoUrl={bj.videoUrl}
                  videoRef={videoRefs.current[brand]}
                  loading={bj.loading ? { stages: bj.loading } : undefined}
                  error={bj.error}
                  emptyMessage="Waiting…"
                />
              </div>
            </div>
          )
        })}
      </div>
    </PageLayout>
  )
}
