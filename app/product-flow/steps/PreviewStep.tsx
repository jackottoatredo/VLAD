'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaPlayer from '@/app/components/MediaPlayer'
import { PREVIEW_BRANDS, TARGET_URL, type PreviewBrand } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productPreview } from '@/app/copy/instructions'
import NameRecordingModal from '@/app/components/NameRecordingModal'

const POLL_MS = 500
const BRANDLESS_SLOT = 'brandless' as const
type Slot = PreviewBrand | typeof BRANDLESS_SLOT
const SLOTS: readonly Slot[] = [...PREVIEW_BRANDS, BRANDLESS_SLOT]

type SlotJob = {
  videoUrl: string | null
  loading: Array<{ label: string; progress: number }> | null
  error: string | null
}

function initialLoadingStages(): Array<{ label: string; progress: number }> {
  return [
    { label: 'Rendering', progress: 0 },
    { label: 'Compositing', progress: 0 },
    { label: 'Clipping', progress: 0 },
  ]
}

function slotLabel(slot: Slot): string {
  return slot === BRANDLESS_SLOT ? 'No brand' : slot
}

type Props = {
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function PreviewStep({ navBack, navForward }: Props) {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const { product, webcamSettings, trimStartSec, trimEndSec, brandVideoUrls, brandJobIds, postprocessVideoUrl, postprocessJobId, flowId, name: existingName, origin } = flow

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

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [nameModalOpen, setNameModalOpen] = useState(false)

  const videoRefs = useRef<Record<Slot, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(SLOTS.map((s) => [s, { current: null }])) as Record<Slot, React.RefObject<HTMLVideoElement | null>>,
  )
  // jobId → slot (including brandless, so its progress is rendered the same way).
  const activeJobsRef = useRef<Map<string, Slot>>(new Map())
  const didAutoGenerate = useRef(false)

  // Polling
  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return
      await Promise.all(
        jobs.map(async ([jobId, slot]) => {
          try {
            const res = await fetch(`/api/render-progress/${jobId}`)
            const job = (await res.json()) as { status: string; rendered?: number; total?: number; composited?: number; videoUrl?: string; videoR2Key?: string; message?: string }
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
            } else if (job.status === 'rendering') {
              const pct = job.total && job.total > 0 ? (job.rendered ?? 0) / job.total * 100 : 0
              setSlotJobs((prev) => ({ ...prev, [slot]: { ...prev[slot], loading: [{ label: 'Rendering', progress: pct }, { label: 'Compositing', progress: 0 }, { label: 'Clipping', progress: 0 }] } }))
            } else if (job.status === 'compositing') {
              const pct = job.total && job.total > 0 ? (job.composited ?? 0) / job.total * 100 : 0
              setSlotJobs((prev) => ({ ...prev, [slot]: { ...prev[slot], loading: [{ label: 'Rendering', progress: 100 }, { label: 'Compositing', progress: pct }, { label: 'Clipping', progress: 0 }] } }))
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

  function handlePlayAll() {
    for (const slot of SLOTS) {
      const v = videoRefs.current[slot].current
      if (v) { v.currentTime = 0; v.play() }
    }
  }

  async function submitSave(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!presenter || !product || !flowId) return { ok: false, error: 'Flow not ready.' }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          name,
          status: 'saved',
          type: 'product',
          productName: product,
          previewVideoR2Key: flow.postprocessVideoR2Key,
          webcamSettings: {
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
          },
          metadata: { trimStartSec, trimEndSec },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setSaveStatus('error')
        const err = data.error ?? 'Failed to save.'
        setSaveError(err)
        return { ok: false, error: err }
      }
      setSaveStatus('saved')
      setNameModalOpen(false)
      flow.markPersisted({ name, status: 'saved' })
      flow.setStep(3)
      return { ok: true }
    } catch {
      setSaveStatus('error')
      setSaveError('Unexpected error.')
      return { ok: false, error: 'Unexpected error.' }
    }
  }

  const allDone = SLOTS.every((s) => !!slotJobs[s].videoUrl)
  const defaultSuffix = (() => {
    if (existingName && product && existingName.startsWith(`${product}-`)) return existingName.slice(product.length + 1)
    return ''
  })()
  const isReopened = origin === 'reopened' && !!existingName

  async function handleSaveChanges() {
    if (!existingName) return
    await submitSave(existingName)
  }

  function handleDiscardChanges() {
    if (!flowId) return
    try { localStorage.removeItem('vlad_product_flow') } catch { /* ignore */ }
    // Full reload re-enters page.tsx which refetches + re-hydrates the recording.
    window.location.assign(`/product-flow?recordingId=${flowId}`)
  }

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
            className="w-full rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-80 disabled:opacity-50"
          >
            Play All
          </button>
          {isReopened ? (
            <>
              <button
                onClick={handleSaveChanges}
                disabled={!allDone || saveStatus === 'saving' || saveStatus === 'saved'}
                className="w-full rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-background disabled:opacity-50"
              >
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save Changes'}
              </button>
              <button
                onClick={handleDiscardChanges}
                disabled={saveStatus === 'saving'}
                className="w-full rounded-md border border-red-500/40 bg-surface px-4 py-1.5 text-sm font-medium text-red-500 shadow-sm hover:bg-red-500/10 disabled:opacity-50"
              >
                Discard Changes
              </button>
            </>
          ) : (
            <button
              onClick={() => setNameModalOpen(true)}
              disabled={!allDone || saveStatus === 'saving' || saveStatus === 'saved'}
              className="w-full rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-background disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'}
            </button>
          )}
          {saveStatus === 'error' && <p className="text-xs text-red-500">{saveError}</p>}
        </div>
      }
    >
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[10px]">
        {SLOTS.map((slot) => {
          const sj = slotJobs[slot]
          return (
            <div key={slot} className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-md">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {slotLabel(slot)}
              </p>
              <div className="flex flex-1 items-center justify-center">
                <MediaPlayer
                  videoUrl={sj.videoUrl}
                  videoRef={videoRefs.current[slot]}
                  loading={sj.loading ? { stages: sj.loading } : undefined}
                  error={sj.error}
                  emptyMessage="Waiting…"
                />
              </div>
            </div>
          )
        })}
      </div>
      {nameModalOpen && product && (
        <NameRecordingModal
          title="Save Recording"
          prefix={product}
          defaultSuffix={defaultSuffix}
          submitLabel="Save"
          onSubmit={submitSave}
          onCancel={() => setNameModalOpen(false)}
        />
      )}
    </PageLayout>
  )
}
