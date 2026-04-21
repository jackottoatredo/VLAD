'use client'

import { useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import WebcamControls from '@/app/components/WebcamControls'
import { useUser, type Merchant } from '@/app/contexts/UserContext'
import { useMerchantFlow } from '@/app/contexts/MerchantFlowContext'
import { MERCHANT_TARGET_URL } from '@/app/config'
import { merchantRecord } from '@/app/copy/instructions'

type Props = {
  recording: ReturnType<typeof import('@/app/hooks/useRecording').useRecording>
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function RecordStep({ recording, navBack, navForward }: Props) {
  const { presenter, merchants, addMerchant } = useUser()
  const { merchantId, webcamSettings, setMerchantId, setWebcamSettings } = useMerchantFlow()

  const selectedMerchant = merchants.find((m) => m.id === merchantId)
  const brand = selectedMerchant?.url ?? ''
  const isCountingDown = recording.countdown != null
  const canStart = !!merchantId && !recording.isRecording && !isCountingDown

  // Add merchant modal
  const [showAddMerchant, setShowAddMerchant] = useState(false)
  const [merchantName, setMerchantName] = useState('')
  const [merchantUrlInput, setMerchantUrlInput] = useState('')
  const [addMerchantError, setAddMerchantError] = useState('')

  async function handleAddMerchant() {
    setAddMerchantError('')
    const res = await fetch('/api/add-merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: merchantName.trim(), url: merchantUrlInput.trim() }),
    })
    const data = await res.json() as { ok?: boolean; merchant?: Merchant; error?: string }
    if (!res.ok || !data.ok || !data.merchant) {
      setAddMerchantError(data.error ?? 'Failed to add merchant.')
      return
    }
    addMerchant(data.merchant)
    setMerchantId(data.merchant.id)
    setMerchantName('')
    setMerchantUrlInput('')
    setShowAddMerchant(false)
  }

  return (
    <>
      <PageLayout
        navBack={navBack}
        navForward={navForward}
        instructions={<Markdown>{merchantRecord}</Markdown>}
        settings={
          <div className="flex flex-col gap-3">
            <div className="flex gap-1">
              <select
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                disabled={recording.isRecording}
                className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm outline-none focus:border-muted disabled:opacity-50"
              >
                <option value="">Select merchant…</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAddMerchant(true)}
                disabled={recording.isRecording}
                className="flex items-center justify-center rounded-md border border-border bg-surface px-2.5 text-muted shadow-sm hover:bg-background disabled:opacity-50"
                title="Add new merchant"
              >
                +
              </button>
            </div>

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
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface p-[10px] shadow-md">
          <RecordingFrame
            iframeRef={recording.iframeRef}
            product={brand}
            recordingKey={recording.recordingKey}
            targetUrl={MERCHANT_TARGET_URL}
            queryParam="brand"
            isRecording={recording.isRecording}
            countdown={recording.countdown}
          >
            <WebcamOverlay webcamSettings={webcamSettings} videoRef={recording.webcamVideoRef} mirror />
          </RecordingFrame>
        </div>
      </PageLayout>

      {showAddMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50">
          <div className="w-80 rounded-xl border border-border bg-surface p-6 shadow-md">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Add New Merchant</h2>
            <div className="flex flex-col gap-3">
              <input type="text" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="Company name" className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted shadow-sm outline-none focus:border-muted" />
              <input type="text" value={merchantUrlInput} onChange={(e) => setMerchantUrlInput(e.target.value)} placeholder="mammut.com" className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted shadow-sm outline-none focus:border-muted" />
              {addMerchantError && <p className="text-xs text-red-500">{addMerchantError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowAddMerchant(false); setMerchantName(''); setMerchantUrlInput(''); setAddMerchantError('') }} className="flex-1 rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground">Cancel</button>
                <button onClick={handleAddMerchant} disabled={!merchantName.trim() || !merchantUrlInput.trim().includes('.')} className="flex-1 rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
