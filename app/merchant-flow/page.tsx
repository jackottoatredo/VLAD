'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MerchantFlowContextProvider, useMerchantFlow } from '@/app/contexts/MerchantFlowContext'
import { DEFAULT_WEBCAM_SETTINGS, type WebcamSettings } from '@/types/webcam'
import MerchantFlowWizard from '@/app/merchant-flow/MerchantFlowWizard'

function MerchantFlowInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const flow = useMerchantFlow()
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
            merchantId: string | null
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
        if (r.type !== 'merchant') {
          setError('That recording is not a merchant flow.')
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
          merchantId: r.merchantId ?? '',
          webcamSettings: ws,
          trimStartSec,
          trimEndSec,
          postprocessVideoUrl: r.previewUrl,
          postprocessVideoR2Key: r.previewR2Key,
          persistedStatus: r.status,
        })
        router.replace('/merchant-flow')
        setLoading(false)
      } catch {
        setError('Failed to load recording.')
        setLoading(false)
      }
    })()
  }, [recordingId, flow, router])

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
  return <MerchantFlowWizard />
}

export default function MerchantFlowPage() {
  return (
    <MerchantFlowContextProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><p className="text-sm text-muted">Loading…</p></div>}>
        <MerchantFlowInner />
      </Suspense>
    </MerchantFlowContextProvider>
  )
}
