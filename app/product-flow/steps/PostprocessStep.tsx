'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaEditor from '@/app/components/MediaEditor'
import { DEFAULT_FPS, TARGET_URL } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { productPostprocess } from '@/app/copy/instructions'

const POLL_MS = 500

type LoadingStage = { label: string; progress: number }

type Props = {
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function PostprocessStep({ navBack, navForward }: Props) {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const { product, webcamSettings, trimStartSec, trimEndSec, postprocessVideoUrl } = flow

  const [videoUrl, setVideoUrl] = useState<string | null>(postprocessVideoUrl)
  const [loading, setLoading] = useState<LoadingStage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const didAutoRender = useRef(false)

  const handleTrimChange = useCallback((start: number, end: number) => {
    flow.setTrim(start, end)
  }, [flow])

  // Polling
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const jobId = jobIdRef.current
      if (!jobId) return
      try {
        const res = await fetch(`/api/render-progress/${jobId}`)
        const job = (await res.json()) as {
          status: string; rendered?: number; composited?: number; total?: number;
          videoUrl?: string; videoR2Key?: string; message?: string;
        }
        if (job.status === 'done' && job.videoUrl) {
          jobIdRef.current = null
          flow.setPostprocessVideoUrl(job.videoUrl, job.videoR2Key)
          setVideoUrl(job.videoUrl)
          setLoading(null)
        } else if (job.status === 'error') {
          jobIdRef.current = null
          setError(job.message ?? 'Processing failed.')
          setLoading(null)
        } else if (job.status === 'rendering') {
          const pct = job.total && job.total > 0 ? (job.rendered ?? 0) / job.total * 100 : 0
          setLoading([
            { label: 'Rendering', progress: pct },
            { label: 'Compositing', progress: 0 },
          ])
        } else if (job.status === 'compositing') {
          const pct = job.total && job.total > 0 ? (job.composited ?? 0) / job.total * 100 : 0
          setLoading([
            { label: 'Rendering', progress: 100 },
            { label: 'Compositing', progress: pct },
          ])
        }
      } catch { /* transient */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [flow])

  // Auto-render on mount if no cached video
  useEffect(() => {
    if (didAutoRender.current || postprocessVideoUrl || !presenter || !product) return
    didAutoRender.current = true
    startRender()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, product, postprocessVideoUrl])

  async function startRender() {
    if (!presenter || !product) return
    setError(null)
    setVideoUrl(null)
    setLoading([
      { label: 'Rendering', progress: 0 },
      { label: 'Compositing', progress: 0 },
    ])
    jobIdRef.current = null

    const url = `${TARGET_URL}?product=${encodeURIComponent(product)}`

    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, product, url,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
          trimStartSec, trimEndSec,
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
      navBack={navBack}
      navForward={navForward}
      instructions={<Markdown>{productPostprocess}</Markdown>}
      settings={null}
    >
      <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
        <MediaEditor
          videoUrl={videoUrl}
          loading={loading ? { stages: loading } : undefined}
          error={error}
          emptyMessage="Rendering will start automatically…"
          fps={DEFAULT_FPS}
          onTrimChange={handleTrimChange}
          initialTrimStart={trimStartSec}
          initialTrimEnd={trimEndSec}
        />
      </div>
    </PageLayout>
  )
}
