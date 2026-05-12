'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaEditor from '@/app/components/MediaEditor'
import { DEFAULT_FPS, MERCHANT_TARGET_URL } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useMerchantFlow } from '@/app/contexts/MerchantFlowContext'
import { merchantPostprocess } from '@/app/copy/instructions'
import type { JobProgress, JobStep } from '@/lib/queue/progress'

const POLL_MS = 500

type LoadingStage = JobStep

const INITIAL_STAGES: LoadingStage[] = [
  { label: 'Rendering', progress: 0 },
  { label: 'Compositing', progress: 0 },
  { label: 'Clipping', progress: 0 },
]

type Props = Record<string, never>

export default function PostprocessStep({}: Props) {
  const { presenter } = useUser()
  const flow = useMerchantFlow()
  const { merchantId, webcamSettings, trimStartSec, trimEndSec, postprocessVideoUrl, flowId, postprocessJobId, origin, websiteUrl: merchantUrl } = flow

  const [videoUrl, setVideoUrl] = useState<string | null>(postprocessVideoUrl)
  const initialLoading: LoadingStage[] | null = postprocessVideoUrl ? null : INITIAL_STAGES
  const [loading, setLoading] = useState<LoadingStage[] | null>(initialLoading)
  const [error, setError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const didAutoRender = useRef(false)

  const handleTrimChange = useCallback((start: number, end: number) => {
    flow.setTrim(start, end)
  }, [flow])

  // Polling — consumes the unified JobProgress contract from /api/jobs/:jobId.
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const jobId = jobIdRef.current
      if (!jobId) return
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        if (!res.ok) return
        const job = (await res.json()) as JobProgress
        if (job.status === 'done' && job.videoUrl) {
          jobIdRef.current = null
          flow.setPostprocessVideoUrl(job.videoUrl, job.videoR2Key)
          setVideoUrl(job.videoUrl)
          setLoading(null)
        } else if (job.status === 'error') {
          jobIdRef.current = null
          setError(job.message ?? 'Processing failed.')
          setLoading(null)
        } else if (job.status === 'running') {
          setLoading(job.steps)
        }
      } catch { /* transient */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [flow])

  // Sync context.postprocessJobId → jobIdRef/loading so the polling effect
  // picks it up when RecordStep's background chain enqueues the job AFTER
  // this component has already mounted.
  useEffect(() => {
    if (!postprocessJobId || postprocessVideoUrl) return
    if (jobIdRef.current === postprocessJobId) return
    jobIdRef.current = postprocessJobId
    setLoading(INITIAL_STAGES)
  }, [postprocessJobId, postprocessVideoUrl])

  // Auto-render only for reopened flows. New-recording flows rely on
  // RecordStep's background chain to enqueue the job after the raw-session
  // upload completes.
  useEffect(() => {
    if (didAutoRender.current || postprocessVideoUrl || !presenter || !merchantId || !flowId) return
    if (postprocessJobId) { didAutoRender.current = true; return }
    if (origin !== 'reopened') return
    didAutoRender.current = true
    startRender()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, merchantId, postprocessVideoUrl, postprocessJobId, flowId, origin])

  async function startRender() {
    if (!presenter || !merchantId || !flowId) return
    setError(null)
    setVideoUrl(null)
    setLoading(INITIAL_STAGES)
    jobIdRef.current = null

    const targetUrl = merchantUrl
      ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantUrl)}`
      : MERCHANT_TARGET_URL

    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          presenter, merchantId, url: targetUrl,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
          preview: true,
        }),
      })
      const data = (await res.json()) as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }
      if (data.videoUrl) {
        flow.setPostprocessVideoUrl(data.videoUrl, data.videoR2Key)
        setVideoUrl(data.videoUrl)
        setLoading(null)
        return
      }
      if (!res.ok || !data.jobId) {
        setError(data.error ?? 'Failed to start processing.')
        setLoading(null)
        return
      }
      jobIdRef.current = data.jobId
    } catch {
      setError('Unexpected error.')
      setLoading(null)
    }
  }

  return (
    <PageLayout
      instructions={<Markdown>{merchantPostprocess}</Markdown>}
      settings={null}
    >
      <div className="flex flex-1 flex-col justify-center gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-md">
        <MediaEditor
          videoUrl={videoUrl}
          loading={loading ? { stages: loading } : undefined}
          error={error}
          errorAction={{ label: 'Try Again', onClick: startRender }}
          emptyMessage="Rendering will start automatically…"
          fps={DEFAULT_FPS}
          onTrimChange={handleTrimChange}
          initialTrimStart={trimStartSec}
          initialTrimEnd={trimEndSec}
          quality="preview"
        />
      </div>
    </PageLayout>
  )
}
