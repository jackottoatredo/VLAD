'use client'

import { useEffect } from 'react'
import PageLayout from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import WebcamControls from '@/app/components/WebcamControls'
import Select from '@/app/components/Select'
import RecordConfirmOverlay from '@/app/components/RecordConfirmOverlay'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productRecord } from '@/app/copy/instructions'
import { PRODUCTS } from '@/lib/products'

type Props = {
  recording: ReturnType<typeof import('@/app/hooks/useRecording').useRecording>
}

export default function RecordStep({ recording }: Props) {
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

  return (
    <PageLayout
      instructions={<Markdown>{productRecord}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Product</p>
            <Select
              options={PRODUCTS.map((p) => ({ value: p.safe, label: p.label }))}
              value={product}
              onChange={setProduct}
              placeholder="Select product…"
              disabled={recording.isRecording || overlayVisible}
            />
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
                : 'bg-accent text-white hover:opacity-80'
            }`}
          >
            {isCountingDown ? 'Starting…' : recording.isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
        </div>
      }
    >
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface p-[10px] shadow-md [container-type:size]">
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
          durationMs={recording.pendingDurationMs}
        />
      </div>
    </PageLayout>
  )
}
