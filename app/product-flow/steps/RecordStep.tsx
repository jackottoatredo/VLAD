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
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">Product</p>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              disabled={recording.isRecording}
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
            disabled={recording.isRecording}
          />

          <hr className="border-border" />

          <button
            onClick={recording.isRecording ? recording.stop : () => recording.start(presenter, product)}
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
