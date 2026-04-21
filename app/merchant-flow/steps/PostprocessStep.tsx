'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout, { type NavButton } from '@/app/components/PageLayout'
import Markdown from '@/app/components/Markdown'
import MediaEditor from '@/app/components/MediaEditor'
import { DEFAULT_FPS, MERCHANT_TARGET_URL } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { useMerchantFlow } from '@/app/contexts/MerchantFlowContext'
import { merchantPostprocess } from '@/app/copy/instructions'

const POLL_MS = 500

type LoadingStage = { label: string; progress: number }

type Props = {
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function PostprocessStep({ navBack, navForward }: Props) {
  const { presenter, merchants } = useUser()
  const flow = useMerchantFlow()
  const { merchantId, webcamSettings, trimStartSec, trimEndSec, postprocessVideoUrl } = flow

  const selectedMerchant = merchants.find((m) => m.id === merchantId)
  const merchantUrl = selectedMerchant?.url ?? ''

  const [videoUrl, setVideoUrl] = useState<string | null>(postprocessVideoUrl)
  const [loading, setLoading] = useState<LoadingStage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
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
          setLoading([{ label: 'Rendering', progress: pct }, { label: 'Compositing', progress: 0 }])
        } else if (job.status === 'compositing') {
          const pct = job.total && job.total > 0 ? (job.composited ?? 0) / job.total * 100 : 0
          setLoading([{ label: 'Rendering', progress: 100 }, { label: 'Compositing', progress: pct }])
        }
      } catch { /* transient */ }
    }, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [flow])

  // Auto-render on mount
  useEffect(() => {
    if (didAutoRender.current || postprocessVideoUrl || !presenter || !merchantId) return
    didAutoRender.current = true
    startRender()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter, merchantId, postprocessVideoUrl])

  async function startRender() {
    if (!presenter || !merchantId) return
    setError(null)
    setVideoUrl(null)
    setLoading([{ label: 'Rendering', progress: 0 }, { label: 'Compositing', progress: 0 }])
    jobIdRef.current = null

    const targetUrl = merchantUrl
      ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(merchantUrl)}`
      : MERCHANT_TARGET_URL

    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

  async function handleSave() {
    if (!presenter || !merchantId) return
    setSaveStatus('saving')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, session: `${presenter}_${merchantId}`, type: 'merchant', merchantId,
          previewVideoR2Key: flow.postprocessVideoR2Key,
          metadata: {
            merchantUrl, trimStartSec, trimEndSec,
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
          },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setSaveStatus('error'); setSaveError(data.error ?? 'Failed.') }
      else { setSaveStatus('saved'); flow.markSaved(); flow.setStep(2) }
    } catch { setSaveStatus('error'); setSaveError('Unexpected error.') }
  }

  return (
    <PageLayout
      navBack={navBack}
      navForward={navForward}
      instructions={<Markdown>{merchantPostprocess}</Markdown>}
      settings={
        <div className="flex flex-col gap-3">
          <button
            onClick={handleSave}
            disabled={!videoUrl || saveStatus === 'saving' || saveStatus === 'saved'}
            className="w-full rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-background disabled:opacity-50"
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
          {saveStatus === 'error' && <p className="text-xs text-red-500">{saveError}</p>}
        </div>
      }
    >
      <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-md">
        <MediaEditor
          videoUrl={videoUrl}
          loading={loading ? { stages: loading } : undefined}
          error={error}
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
