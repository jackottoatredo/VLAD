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

  function handleRecordAgain() {
    if (!presenter || !merchantId) return
    recording.start(presenter, merchantId)
  }

  async function handleContinue() {
    if (!presenter || !merchantId) return
    const ok = await recording.commit()
    if (!ok) return
    flow.clearResults()
    flow.setStep(1)
  }

  const isCountingDown = recording.countdown != null
  const canStart = !!merchantId && !recording.isRecording && !isCountingDown

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
              disabled={recording.isRecording}
              className="flex w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-left text-sm text-foreground shadow-sm hover:bg-background disabled:opacity-50"
            >
              <span className={merchantId ? '' : 'text-muted'}>
                {merchantId ? brandName : 'Select merchant…'}
              </span>
              <span className="text-xs text-muted">{merchantId ? 'Change' : ''}</span>
            </button>

            <WebcamControls settings={webcamSettings} onChange={setWebcamSettings} disabled={recording.isRecording} />

            <button
              onClick={recording.isRecording ? recording.stop : () => recording.start(presenter, merchantId)}
              disabled={isCountingDown || (!recording.isRecording && !canStart)}
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
            uploadStatus={recording.uploadStatus}
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
