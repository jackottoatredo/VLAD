'use client'

import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import WebcamControls from '@/app/components/WebcamControls'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productRecord } from '@/app/copy/instructions'

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
  const { product, webcamSettings, setProduct, setWebcamSettings } = useProductFlow()

  const isCountingDown = recording.countdown != null
  const canStart = !!presenter && !!product && !recording.isRecording && !isCountingDown

  return (
    <PageLayout
      navBack={navBack}
      navForward={navForward}
      instructions={<Markdown>{productRecord}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            disabled={recording.isRecording}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">Select product…</option>
            {PRODUCTS.map((p) => (
              <option key={p.safe} value={p.safe}>{p.label}</option>
            ))}
          </select>

          <WebcamControls
            settings={webcamSettings}
            onChange={setWebcamSettings}
            disabled={recording.isRecording}
          />

          <button
            onClick={recording.isRecording ? recording.stop : () => recording.start(presenter, product)}
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
          product={product}
          recordingKey={recording.recordingKey}
          isRecording={recording.isRecording}
          countdown={recording.countdown}
        >
          <WebcamOverlay webcamSettings={webcamSettings} videoRef={recording.webcamVideoRef} mirror />
        </RecordingFrame>
      </div>
    </PageLayout>
  )
}
