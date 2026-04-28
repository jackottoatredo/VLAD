'use client'

import { useEffect, useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import WebcamControls from '@/app/components/WebcamControls'
import RecordConfirmOverlay from '@/app/components/RecordConfirmOverlay'
import MerchantPickerModal from '@/app/components/MerchantPickerModal'
import { useUser } from '@/app/contexts/UserContext'
import { useMerchantFlow } from '@/app/contexts/MerchantFlowContext'
import { MERCHANT_TARGET_URL } from '@/app/config'
import { merchantRecord } from '@/app/copy/instructions'

type Props = {
  recording: ReturnType<typeof import('@/app/hooks/useRecording').useRecording>
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function RecordStep({ recording, navBack, navForward }: Props) {
  const { presenter } = useUser()
  const flow = useMerchantFlow()
  const { merchantId, brandName, websiteUrl, webcamSettings, setMerchant, setWebcamSettings } = flow

  // Verify webcam access every time the record page is entered.
  useEffect(() => {
    if (webcamSettings.webcamMode !== 'off') void recording.ensureWebcam()
  }, [recording, webcamSettings.webcamMode])

  useEffect(() => {
    if (recording.webcamError) alert(recording.webcamError)
  }, [recording.webcamError])

  const isCountingDown = recording.countdown != null
  const canStart = !!merchantId && !recording.isRecording && !isCountingDown
  const hasCommitted = !!flow.flowId
  const overlayStatus: 'idle' | 'uploading' | 'ready' =
    recording.uploadStatus !== 'idle' ? recording.uploadStatus : (hasCommitted ? 'ready' : 'idle')
  const overlayVisible = overlayStatus !== 'idle'

  async function handleRecordAgain() {
    if (hasCommitted && flow.flowId) {
      try { await fetch(`/api/sessions/${flow.flowId}`, { method: 'DELETE' }) } catch { /* ignore */ }
      flow.discardRecording()
    } else {
      flow.clearResults()
    }
    recording.resetPending()
  }

  function handleContinue() {
    if (!presenter || !merchantId) return
    if (hasCommitted && recording.uploadStatus === 'idle') {
      flow.setStep(1)
      return
    }
    // Navigate immediately — modal unmounts with the RecordStep. Upload and
    // the produce enqueue run in the background; PostprocessStep picks up the
    // jobId via context when it arrives.
    flow.clearResults()
    flow.setStep(1)

    void (async () => {
      const flowId = await recording.commit()
      if (!flowId) return
      const targetUrl = websiteUrl
        ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(websiteUrl)}`
        : MERCHANT_TARGET_URL
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          presenter, merchantId, url: targetUrl,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          preview: true,
        }),
      })
        .then((r) => r.json() as Promise<{ jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }>)
        .catch(() => ({} as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }))
      if (res.videoUrl) flow.setPostprocessVideoUrl(res.videoUrl, res.videoR2Key)
      else if (res.jobId) flow.setPostprocessJobId(res.jobId)
    })()
  }

  const [showPicker, setShowPicker] = useState(false)

  return (
    <>
      <PageLayout
        navBack={navBack}
        navForward={navForward}
        instructions={<Markdown>{merchantRecord}</Markdown>}
        settings={
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowPicker(true)}
              disabled={recording.isRecording || overlayVisible}
              className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-left text-sm text-foreground shadow-sm hover:bg-background disabled:opacity-50"
            >
              <span className={merchantId ? '' : 'text-muted'}>
                {merchantId ? brandName : 'Select merchant…'}
              </span>
              <span className="text-xs text-muted">{merchantId ? 'Change' : ''}</span>
            </button>

            <WebcamControls settings={webcamSettings} onChange={setWebcamSettings} disabled={recording.isRecording || overlayVisible} />

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
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface p-[10px] shadow-md">
          <RecordingFrame
            iframeRef={recording.iframeRef}
            product={websiteUrl}
            recordingKey={recording.recordingKey}
            targetUrl={MERCHANT_TARGET_URL}
            queryParam="brand"
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

      {showPicker && (
        <MerchantPickerModal
          onSelect={(m) => {
            setMerchant(m)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  )
}
