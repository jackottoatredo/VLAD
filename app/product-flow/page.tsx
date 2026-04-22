'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ProductFlowContextProvider, useProductFlow } from '@/app/contexts/ProductFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { DEFAULT_WEBCAM_SETTINGS, type WebcamSettings } from '@/types/webcam'
import { EAGER_PREVIEW_RENDERING, PREVIEW_BRANDS, TARGET_URL } from '@/app/config'
import ProductFlowWizard from '@/app/product-flow/ProductFlowWizard'

function ProductFlowInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const flow = useProductFlow()
  const { presenter } = useUser()
  const recordingId = searchParams?.get('recordingId') ?? null
  const [loading, setLoading] = useState(!!recordingId)
  const [error, setError] = useState<string | null>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (!recordingId || handledRef.current) return
    handledRef.current = true
    ;(async () => {
      try {
        const res = await fetch(`/api/recordings/${recordingId}`)
        const data = (await res.json()) as {
          recording?: {
            id: string
            type: 'product' | 'merchant'
            name: string
            productName: string | null
            status: 'draft' | 'saved'
            previewUrl: string | null
            previewR2Key: string | null
            webcamSettings: unknown
            metadata: Record<string, unknown>
          }
          error?: string
        }
        if (!res.ok || !data.recording) {
          setError(data.error ?? 'Recording not found.')
          setLoading(false)
          return
        }
        const r = data.recording
        if (r.type !== 'product') {
          setError('That recording is not a product flow.')
          setLoading(false)
          return
        }
        const meta = r.metadata ?? {}
        const trimStartSec = typeof meta.trimStartSec === 'number' ? meta.trimStartSec : 0
        const trimEndSec = typeof meta.trimEndSec === 'number' ? meta.trimEndSec : 0
        const ws: WebcamSettings =
          r.webcamSettings && typeof r.webcamSettings === 'object'
            ? (r.webcamSettings as WebcamSettings)
            : { ...DEFAULT_WEBCAM_SETTINGS }
        flow.hydrateFromRecording({
          flowId: r.id,
          name: r.name,
          product: r.productName ?? '',
          webcamSettings: ws,
          trimStartSec,
          trimEndSec,
          postprocessVideoUrl: r.previewUrl,
          postprocessVideoR2Key: r.previewR2Key,
          persistedStatus: r.status,
        })
        // Strip the query param so refreshes resume from localStorage instead of refetching.
        router.replace('/product-flow')
        setLoading(false)

        // Brand previews aren't persisted; re-enqueue the 3 branded renders now
        // so they're ready (or in flight) by the time the user reaches Preview.
        if (EAGER_PREVIEW_RENDERING && presenter && r.productName) {
          const brandlessUrl = `${TARGET_URL}?product=${encodeURIComponent(r.productName)}`
          const common = {
            flowId: r.id,
            presenter,
            product: r.productName,
            webcamMode: ws.webcamMode,
            webcamVertical: ws.webcamVertical,
            webcamHorizontal: ws.webcamHorizontal,
            trimStartSec,
            trimEndSec,
            preview: true as const,
            priority: 2,
          }
          for (const brand of PREVIEW_BRANDS) {
            fetch('/api/produce', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...common, url: `${brandlessUrl}&brand=${encodeURIComponent(brand)}` }),
            })
              .then((resp) => resp.json() as Promise<{ jobId?: string; videoUrl?: string; videoR2Key?: string }>)
              .then((res) => {
                if (res.videoUrl) flow.setBrandVideoUrl(brand, res.videoUrl)
                else if (res.jobId) flow.setBrandJobId(brand, res.jobId)
              })
              .catch(() => { /* ignore; PreviewStep has a fallback */ })
          }
        }
      } catch {
        setError('Failed to load recording.')
        setLoading(false)
      }
    })()
  }, [recordingId, flow, router, presenter])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading recording…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }
  return <ProductFlowWizard />
}

export default function ProductFlowPage() {
  return (
    <ProductFlowContextProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><p className="text-sm text-muted">Loading…</p></div>}>
        <ProductFlowInner />
      </Suspense>
    </ProductFlowContextProvider>
  )
}
