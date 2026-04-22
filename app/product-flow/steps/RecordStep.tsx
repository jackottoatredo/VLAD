'use client'

import { useEffect } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import WebcamControls from '@/app/components/WebcamControls'
import RecordConfirmOverlay from '@/app/components/RecordConfirmOverlay'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productRecord } from '@/app/copy/instructions'
import { EAGER_PREVIEW_RENDERING, PREVIEW_BRANDS, TARGET_URL } from '@/app/config'

const PRODUCTS = [
  { label: 'Returns & Claims', safe: 'returns-claims' },
  { label: 'Chargebacks', safe: 'chargebacks' },
  { label: 'Recover', safe: 'recover' },
  { label: 'Checkout Optimization', safe: 'checkout-optimization' },
  { label: 'Email & SMS', safe: 'email-sms' },
  { label: 'Order Editing', safe: 'order-editing' },
  { label: 'Shipping & Fulfillment', safe: 'shipping-fulfillment' },
  { label: 'Order Tracking', safe: 'order-tracking' },
  { label: 'AI Sales Support', safe: 'ai-sales-support' },
  { label: 'Warranties', safe: 'warranties' },
  { label: 'Inventory Management', safe: 'inventory-management' },
  { label: 'Agentic Catalog', safe: 'agentic-catalog' },
]

type Props = {
  recording: ReturnType<typeof import('@/app/hooks/useRecording').useRecording>
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function RecordStep({ recording, navBack, navForward }: Props) {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const { product, webcamSettings, setProduct, setWebcamSettings } = flow

  // Verify webcam access every time the record page is entered.
  useEffect(() => {
    if (webcamSettings.webcamMode !== 'off') void recording.ensureWebcam()
  }, [recording, webcamSettings.webcamMode])

  useEffect(() => {
    if (recording.webcamError) alert(recording.webcamError)
  }, [recording.webcamError])

  const isCountingDown = recording.countdown != null
  const canStart = !!presenter && !!product && !recording.isRecording && !isCountingDown
  // Overlay visible whenever the flow has an unresolved take to confirm OR a
  // recording already committed to the flow (e.g. user navigated back from
  // Postprocess or resumed via localStorage).
  const hasCommitted = !!flow.flowId
  const overlayStatus: 'idle' | 'uploading' | 'ready' =
    recording.uploadStatus !== 'idle' ? recording.uploadStatus : (hasCommitted ? 'ready' : 'idle')
  const overlayVisible = overlayStatus !== 'idle'

  async function cancelActiveJobs() {
    const ids = flow.getActiveJobIds()
    if (ids.length === 0) return
    // Best-effort: fire-and-forget. job.remove() only cancels queued jobs; running jobs
    // will complete naturally and their results populate cache (harmless).
    fetch('/api/cancel-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds: ids }),
    }).catch(() => { /* ignore */ })
  }

  async function handleRecordAgain() {
    await cancelActiveJobs()
    // If the flow already has a committed recording, discard it entirely —
    // delete raw R2 session files and reset the flow. User then re-arms controls
    // and hits Start when ready.
    if (hasCommitted && flow.flowId) {
      try { await fetch(`/api/sessions/${flow.flowId}`, { method: 'DELETE' }) } catch { /* ignore */ }
      flow.discardRecording()
    } else {
      flow.clearResults()
    }
    recording.resetPending()
  }

  async function handleContinue() {
    if (!presenter || !product) return
    // Already-committed flow: nothing to upload, just advance.
    if (hasCommitted && recording.uploadStatus === 'idle') {
      flow.setStep(1)
      return
    }
    const flowId = await recording.commit()
    if (!flowId) return
    // Recording is now persisted to R2. Clear any stale previews from a prior take
    // before seeding new jobIds, otherwise clearResults would wipe them right back out.
    flow.clearResults()
    if (EAGER_PREVIEW_RENDERING) {
      const brandlessUrl = `${TARGET_URL}?product=${encodeURIComponent(product)}`
      const common = {
        flowId,
        presenter, product,
        webcamMode: webcamSettings.webcamMode,
        webcamVertical: webcamSettings.webcamVertical,
        webcamHorizontal: webcamSettings.webcamHorizontal,
        preview: true as const,
      }

      const postRender = (url: string, priority: number) =>
        fetch('/api/produce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...common, url, priority }),
        })
          .then((r) => r.json() as Promise<{ jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }>)
          .catch(() => ({} as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }))

      const [brandless, ...branded] = await Promise.all([
        postRender(brandlessUrl, 1),
        ...PREVIEW_BRANDS.map((b) => postRender(`${brandlessUrl}&brand=${encodeURIComponent(b)}`, 2)),
      ])

      if (brandless.videoUrl) flow.setPostprocessVideoUrl(brandless.videoUrl, brandless.videoR2Key)
      else if (brandless.jobId) flow.setPostprocessJobId(brandless.jobId)

      PREVIEW_BRANDS.forEach((brand, i) => {
        const res = branded[i]
        if (res?.videoUrl) flow.setBrandVideoUrl(brand, res.videoUrl)
        else if (res?.jobId) flow.setBrandJobId(brand, res.jobId)
      })
    }

    flow.setStep(1)
  }

  return (
    <PageLayout
      navBack={navBack}
      navForward={navForward}
      instructions={<Markdown>{productRecord}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Product</p>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              disabled={recording.isRecording || overlayVisible}
              className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm outline-none focus:border-muted disabled:opacity-50"
            >
              <option value="">Select product…</option>
              {PRODUCTS.map((p) => (
                <option key={p.safe} value={p.safe}>{p.label}</option>
              ))}
            </select>
          </div>

          <hr className="border-border" />

          <WebcamControls
            settings={webcamSettings}
            onChange={setWebcamSettings}
            disabled={recording.isRecording || overlayVisible}
          />

          <hr className="border-border" />

          <button
            onClick={recording.isRecording ? recording.stop : () => recording.start(presenter)}
            disabled={isCountingDown || overlayVisible || (!recording.isRecording && !canStart)}
            className={`w-full rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              recording.isRecording
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-foreground text-background hover:opacity-80'
            }`}
          >
            {isCountingDown ? 'Starting…' : recording.isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
        </div>
      }
    >
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface p-[10px] shadow-md">
        <RecordingFrame
          iframeRef={recording.iframeRef}
          product={product}
          recordingKey={recording.recordingKey}
          isRecording={recording.isRecording}
          countdown={recording.countdown}
        >
          <WebcamOverlay webcamSettings={webcamSettings} videoRef={recording.webcamVideoRef} mirror />
        </RecordingFrame>
        <RecordConfirmOverlay
          uploadStatus={overlayStatus}
          onRecordAgain={handleRecordAgain}
          onContinue={handleContinue}
        />
      </div>
    </PageLayout>
  )
}
