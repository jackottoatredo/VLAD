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
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="">Select merchant…</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAddMerchant(true)}
                disabled={recording.isRecording}
                className="flex items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                title="Add new merchant"
              >
                +
              </button>
            </div>

            <WebcamControls settings={webcamSettings} onChange={setWebcamSettings} disabled={recording.isRecording} />

            <button
              onClick={recording.isRecording ? recording.stop : () => recording.start(presenter, merchantId)}
              disabled={isCountingDown || (!recording.isRecording && !canStart)}
              className={`w-full rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed text-white ${
                recording.isRecording
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'
              }`}
            >
              {isCountingDown ? 'Starting…' : recording.isRecording ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>
        }
      >
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-300 p-[10px] dark:border-zinc-700">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Add New Merchant</h2>
            <div className="flex flex-col gap-3">
              <input type="text" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="Company name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              <input type="text" value={merchantUrlInput} onChange={(e) => setMerchantUrlInput(e.target.value)} placeholder="mammut.com" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              {addMerchantError && <p className="text-xs text-red-500">{addMerchantError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowAddMerchant(false); setMerchantName(''); setMerchantUrlInput(''); setAddMerchantError('') }} className="flex-1 rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
                <button onClick={handleAddMerchant} disabled={!merchantName.trim() || !merchantUrlInput.trim().includes('.')} className="flex-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
