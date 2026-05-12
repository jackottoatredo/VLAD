'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaPlayer from '@/app/components/MediaPlayer'
import { PREVIEW_BRANDS, TARGET_URL, type PreviewBrand } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productPreview } from '@/app/copy/instructions'
import type { JobProgress, JobStep } from '@/lib/queue/progress'

const POLL_MS = 500
const BRANDLESS_SLOT = 'brandless' as const
type Slot = PreviewBrand | typeof BRANDLESS_SLOT
const SLOTS: readonly Slot[] = [...PREVIEW_BRANDS, BRANDLESS_SLOT]

type SlotJob = {
  videoUrl: string | null
  loading: JobStep[] | null
  error: string | null
}

function initialLoadingStages(): JobStep[] {
  return [
    { label: 'Rendering', progress: 0 },
    { label: 'Compositing', progress: 0 },
  ]
}

function slotLabel(slot: Slot): string {
  return slot === BRANDLESS_SLOT ? 'No brand' : slot
}

type Props = Record<string, never>

export default function PreviewStep({}: Props) {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const { product, webcamSettings, trimStartSec, trimEndSec, brandVideoUrls, brandJobIds, postprocessVideoUrl, postprocessJobId, flowId } = flow

  // Initial slot state seeds from whatever's already in context so the user
  // sees the previous (possibly stale-trim) preview while we regenerate in
  // the background with the current trim. Each generate* call preserves the
  // existing URL during regeneration so there's no flicker.
  const [slotJobs, setSlotJobs] = useState<Record<Slot, SlotJob>>(() => {
    const initial = {} as Record<Slot, SlotJob>
    for (const brand of PREVIEW_BRANDS) {
      const cachedUrl = brandVideoUrls[brand] ?? null
      initial[brand] = {
        videoUrl: cachedUrl,
        loading: !cachedUrl && brandJobIds[brand] ? initialLoadingStages() : null,
        error: null,
      }
    }
    initial[BRANDLESS_SLOT] = {
      videoUrl: postprocessVideoUrl,
      loading: !postprocessVideoUrl && postprocessJobId ? initialLoadingStages() : null,
      error: null,
    }
    return initial
  })

  const videoRefs = useRef<Record<Slot, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(SLOTS.map((s) => [s, { current: null }])) as Record<Slot, React.RefObject<HTMLVideoElement | null>>,
  )
  // jobId → slot (including brandless, so its progress is rendered the same way).
  const activeJobsRef = useRef<Map<string, Slot>>(new Map())
  const didAutoGenerate = useRef(false)
  // True only while handlePlayAll is mid-flight. Read by each tile's onPlay
  // handler to decide whether a `play` event came from Play All (keep the
  // assigned mute state) or from a native-controls click (force unmute).
  const playingAllRef = useRef(false)

  // Polling — consumes the unified JobProgress contract from /api/jobs/:jobId.
  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return
      await Promise.all(
        jobs.map(async ([jobId, slot]) => {
          try {
            const res = await fetch(`/api/jobs/${jobId}`)
            if (!res.ok) return
            const job = (await res.json()) as JobProgress
            if (job.status === 'done' && job.videoUrl) {
              activeJobsRef.current.delete(jobId)
              // Persist brand URLs to context so they survive nav; brandless
              // stays local to slot 4 (we don't overwrite flow.postprocessVideoUrl,
              // which is the canonical un-trimmed composite used for save).
              if (slot !== BRANDLESS_SLOT) {
                flow.setBrandJobId(slot, null)
                flow.setBrandVideoUrl(slot, job.videoUrl)
              }
              setSlotJobs((prev) => ({ ...prev, [slot]: { videoUrl: job.videoUrl!, loading: null, error: null } }))
            } else if (job.status === 'error') {
              activeJobsRef.current.delete(jobId)
              if (slot !== BRANDLESS_SLOT) flow.setBrandJobId(slot, null)
              setSlotJobs((prev) => ({ ...prev, [slot]: { ...prev[slot], loading: null, error: job.message ?? 'Failed.' } }))
            } else if (job.status === 'running') {
              setSlotJobs((prev) => ({ ...prev, [slot]: { ...prev[slot], loading: job.steps } }))
            }
          } catch { /* transient */ }
        }),
      )
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [flow])

  // On mount, always regenerate every slot with the current trim so preview
  // lengths match the user's trim selection. Produce's Redis cache is keyed
  // by trim, so unchanged-trim calls return cached URLs immediately; changed
  // trim kicks off a fresh render. Existing slot URLs stay visible while the
  // new render is in flight (see generate* below).
  useEffect(() => {
    if (didAutoGenerate.current || !presenter || !product || !flowId) return
    didAutoGenerate.current = true
    PREVIEW_BRANDS.forEach(generateBrand)
    generateBrandless()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, product, flowId])

  async function generateBrand(brand: PreviewBrand) {
    if (!flowId) return
    // Preserve any existing URL so the user keeps seeing the previous preview
    // (with stale trim) while the new one renders — no flicker.
    setSlotJobs((prev) => {
      const cur = prev[brand]
      return {
        ...prev,
        [brand]: cur.videoUrl
          ? { ...cur, error: null }
          : { videoUrl: null, loading: initialLoadingStages(), error: null },
      }
    })
    const url = `${TARGET_URL}?product=${encodeURIComponent(product)}&brand=${encodeURIComponent(brand)}`
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          presenter, product, url,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
          preview: true,
          priority: 2,
        }),
      })
      const data = (await res.json()) as { jobId?: string; videoUrl?: string; error?: string }
      if (data.videoUrl) {
        flow.setBrandVideoUrl(brand, data.videoUrl)
        setSlotJobs((prev) => ({ ...prev, [brand]: { videoUrl: data.videoUrl!, loading: null, error: null } }))
        return
      }
      if (!res.ok || !data.jobId) {
        setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: null, error: data.error ?? 'Failed.' } }))
        return
      }
      flow.setBrandJobId(brand, data.jobId)
      activeJobsRef.current.set(data.jobId, brand)
    } catch {
      setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: null, error: 'Unexpected error.' } }))
    }
  }

  async function generateBrandless() {
    if (!flowId) return
    setSlotJobs((prev) => {
      const cur = prev[BRANDLESS_SLOT]
      return {
        ...prev,
        [BRANDLESS_SLOT]: cur.videoUrl
          ? { ...cur, error: null }
          : { videoUrl: null, loading: initialLoadingStages(), error: null },
      }
    })
    const url = `${TARGET_URL}?product=${encodeURIComponent(product)}`
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          presenter, product, url,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
          preview: true,
          priority: 1,
        }),
      })
      const data = (await res.json()) as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }
      if (data.videoUrl) {
        setSlotJobs((prev) => ({ ...prev, [BRANDLESS_SLOT]: { videoUrl: data.videoUrl!, loading: null, error: null } }))
        return
      }
      if (!res.ok || !data.jobId) {
        setSlotJobs((prev) => ({ ...prev, [BRANDLESS_SLOT]: { ...prev[BRANDLESS_SLOT], loading: null, error: data.error ?? 'Failed.' } }))
        return
      }
      activeJobsRef.current.set(data.jobId, BRANDLESS_SLOT)
    } catch {
      setSlotJobs((prev) => ({ ...prev, [BRANDLESS_SLOT]: { ...prev[BRANDLESS_SLOT], loading: null, error: 'Unexpected error.' } }))
    }
  }

  async function handlePlayAll() {
    // All four renders share the same audio track, so only one plays unmuted
    // to avoid a 4× echo. The first slot is the audio source; the rest mute.
    // playingAllRef suppresses the onPlay-unmute below for this batch only.
    playingAllRef.current = true
    try {
      await Promise.all(
        SLOTS.map((slot, i) => {
          const v = videoRefs.current[slot].current
          if (!v) return null
          v.muted = i !== 0
          v.currentTime = 0
          return v.play().catch(() => {})
        }),
      )
    } finally {
      playingAllRef.current = false
    }
  }

  function handleVideoPlay(e: React.SyntheticEvent<HTMLVideoElement>) {
    // Native-controls play on a single tile: restore audio. During Play All
    // this is short-circuited so the assigned mute pattern survives.
    if (playingAllRef.current) return
    e.currentTarget.muted = false
  }

  const allDone = SLOTS.every((s) => !!slotJobs[s].videoUrl)

  return (
    <PageLayout
      instructions={<Markdown>{productPreview}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <button
            onClick={handlePlayAll}
            disabled={!allDone}
            className="w-full rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-80 disabled:opacity-50"
          >
            Play All
          </button>
        </div>
      }
    >
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
        {SLOTS.map((slot) => {
          const sj = slotJobs[slot]
          return (
            <div key={slot} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-md">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {slotLabel(slot)}
              </p>
              <div className="flex flex-1 items-center justify-center [container-type:size]">
                <div style={{ width: 'min(100cqw, calc(100cqh * 16 / 9))' }}>
                  <MediaPlayer
                    videoUrl={sj.videoUrl}
                    videoRef={videoRefs.current[slot]}
                    loading={sj.loading ? { stages: sj.loading } : undefined}
                    error={sj.error}
                    emptyMessage="Waiting…"
                    onPlay={handleVideoPlay}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </PageLayout>
  )
}
