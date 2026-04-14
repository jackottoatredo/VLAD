'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import VideoTrimmer from '@/app/postprocess/VideoTrimmer'
import { DEFAULT_FPS } from '@/app/config'
import { useAppContext, computeStartStep, type PipelineCache } from '@/app/appContext'

const JOB_POLL_INTERVAL_MS = 500

type JobStatus =
  | { status: 'idle' }
  | { status: 'rendering'; rendered: number; total: number }
  | { status: 'compositing'; composited: number; total: number }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }

export default function MerchantPostprocessPage() {
  const {
    merchants,
    merchant: merchantDraft,
    setMerchantTrim,
    setMerchantPipelineCache,
    clearMerchantPipelineCache,
    markMerchantSaved,
  } = useAppContext()

  const { presenter, session, merchantId, webcamSettings, trimStartSec, trimEndSec, pipelineCache, savedToLibrary } = merchantDraft
  const sessionKey = `${presenter}/${session}`

  const [jobStatus, setJobStatus] = useState<JobStatus>({ status: 'idle' })
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const jobIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleTrimChange = useCallback((start: number, end: number) => {
    setMerchantTrim(start, end)
  }, [setMerchantTrim])

  const selectedMerchant = merchants.find((m) => m.id === merchantId)
  const merchantUrl = selectedMerchant?.url ?? ''

  const startStep = computeStartStep(pipelineCache, sessionKey, webcamSettings)

  const cachedVideoUrl = pipelineCache
    ? (pipelineCache.trimmedUrl ?? pipelineCache.compositeUrl) || null
    : null

  // On mount / session change: restore from cache or idle
  useEffect(() => {
    setSaveStatus(savedToLibrary ? 'saved' : 'idle')
    setSaveError('')
    if (startStep === 'cached' && cachedVideoUrl) {
      setJobStatus({ status: 'done', videoUrl: cachedVideoUrl })
    } else if (startStep !== 1 && pipelineCache?.compositeUrl) {
      setJobStatus({ status: 'done', videoUrl: pipelineCache.compositeUrl })
    } else {
      setJobStatus({ status: 'idle' })
    }
    jobIdRef.current = null
  }, [presenter, session, startStep, cachedVideoUrl, pipelineCache?.compositeUrl, savedToLibrary])

  // Poll for job progress
  useEffect(() => {
    pollingRef.current = setInterval(async () => {
      const jobId = jobIdRef.current
      if (!jobId) return
      try {
        const res = await fetch(`/api/render-progress/${jobId}`)
        const job = (await res.json()) as {
          status: string; rendered?: number; composited?: number; total?: number;
          videoUrl?: string; message?: string;
          renderUrl?: string; renderPath?: string; renderDurationMs?: number;
          compositeUrl?: string; compositePath?: string; trimmedUrl?: string | null;
        }
        if (job.status === 'done' && job.videoUrl) {
          jobIdRef.current = null
          const cache: PipelineCache = {
            sessionKey,
            renderUrl: job.renderUrl ?? '',
            renderPath: job.renderPath ?? '',
            renderDurationMs: job.renderDurationMs ?? 0,
            compositeUrl: job.compositeUrl ?? '',
            compositePath: job.compositePath ?? '',
            webcamSettings: { ...webcamSettings },
            trimmedUrl: job.trimmedUrl ?? null,
            trimStartSec,
            trimEndSec,
          }
          setMerchantPipelineCache(cache)
          setJobStatus({ status: 'done', videoUrl: job.videoUrl })
        } else if (job.status === 'error') {
          jobIdRef.current = null
          setJobStatus({ status: 'error', message: job.message ?? 'Processing failed.' })
        } else if (job.status === 'rendering') {
          setJobStatus({ status: 'rendering', rendered: job.rendered ?? 0, total: job.total ?? 0 })
        } else if (job.status === 'compositing') {
          setJobStatus({ status: 'compositing', composited: job.composited ?? 0, total: job.total ?? 0 })
        }
      } catch { /* transient */ }
    }, JOB_POLL_INTERVAL_MS)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [sessionKey, webcamSettings, trimStartSec, trimEndSec, setMerchantPipelineCache])

  async function handleRender() {
    if (!presenter || !session) return

    const step = computeStartStep(pipelineCache, sessionKey, webcamSettings)
    if (step === 'cached') {
      if (cachedVideoUrl) setJobStatus({ status: 'done', videoUrl: cachedVideoUrl })
      return
    }

    if (step >= 2) {
      setJobStatus({ status: 'compositing', composited: 0, total: 0 })
    } else {
      setJobStatus({ status: 'rendering', rendered: 0, total: 0 })
    }
    jobIdRef.current = null

    const targetUrl = merchantUrl
      ? `http://search.redo.com/record?brand=${encodeURIComponent(merchantUrl)}`
      : 'http://search.redo.com/record'

    const bodyObj: Record<string, unknown> = {
      presenter, session, targetUrl,
      webcamMode: webcamSettings.webcamMode,
      webcamVertical: webcamSettings.webcamVertical,
      webcamHorizontal: webcamSettings.webcamHorizontal,
      trimStartSec, trimEndSec,
      startFromStep: step,
    }

    if (step >= 2 && pipelineCache) {
      bodyObj.existingRenderPath = pipelineCache.renderPath
      bodyObj.existingRenderUrl = pipelineCache.renderUrl
      bodyObj.existingRenderDurationMs = pipelineCache.renderDurationMs
    }
    if (step >= 3 && pipelineCache) {
      bodyObj.existingCompositePath = pipelineCache.compositePath
      bodyObj.existingCompositeUrl = pipelineCache.compositeUrl
    }

    try {
      const res = await fetch('/api/composite-postprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      })
      const data = (await res.json()) as { jobId?: string; error?: string }
      if (res.status === 404 && pipelineCache) {
        clearMerchantPipelineCache()
        setJobStatus({ status: 'rendering', rendered: 0, total: 0 })
        const retryRes = await fetch('/api/composite-postprocess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            presenter, session, targetUrl,
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
            trimStartSec, trimEndSec,
            startFromStep: 1,
          }),
        })
        const retryData = (await retryRes.json()) as { jobId?: string; error?: string }
        if (!retryRes.ok || !retryData.jobId) {
          setJobStatus({ status: 'error', message: retryData.error ?? 'Failed to start processing.' })
          return
        }
        jobIdRef.current = retryData.jobId
        return
      }
      if (!res.ok || !data.jobId) {
        setJobStatus({ status: 'error', message: data.error ?? 'Failed to start processing.' })
        return
      }
      jobIdRef.current = data.jobId
    } catch {
      setJobStatus({ status: 'error', message: 'Unexpected error starting processing.' })
    }
  }

  async function handleSave() {
    if (!presenter || !session) return
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter, session, type: 'merchant', merchantId,
          metadata: {
            merchantUrl, trimStartSec, trimEndSec,
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
          },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setSaveStatus('error')
        setSaveError(data.error ?? 'Failed to save to library.')
      } else {
        setSaveStatus('saved')
        markMerchantSaved()
      }
    } catch {
      setSaveStatus('error')
      setSaveError('Unexpected error.')
    } finally {
      setIsSaving(false)
    }
  }

  const isProcessing = jobStatus.status === 'rendering' || jobStatus.status === 'compositing'
  const canRender = !!presenter && !!session && !isProcessing

  const stepLabel = startStep === 1 ? 'Full render'
    : startStep === 2 ? 'Recomposite (skip Playwright)'
    : startStep === 3 ? 'Retrim only'
    : null

  const renderProgress =
    jobStatus.status === 'rendering' && jobStatus.total > 0
      ? Math.round((jobStatus.rendered / jobStatus.total) * 100)
      : jobStatus.status === 'compositing' || jobStatus.status === 'done' ? 100 : 0
  const composeProgress =
    jobStatus.status === 'compositing' && jobStatus.total > 0
      ? Math.round((jobStatus.composited / jobStatus.total) * 100)
      : jobStatus.status === 'done' ? 100 : 0

  return (
    <>
      <PageLayout
        instructions={
          <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <p>Review your merchant recording and trim any dead air from the start and end.</p>
            <p>Drag the green handles to set in/out points, or use arrow keys for frame-by-frame precision.</p>
          </div>
        }
        settings={
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {presenter && session ? <span>{session}</span> : <span className="text-zinc-400">No recording selected — go to Merchant first</span>}
            </div>

            {(jobStatus.status === 'idle' || jobStatus.status === 'error') && canRender && (
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleRender}
                  className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Render
                </button>
                {stepLabel && <p className="text-xs text-zinc-400">{stepLabel}</p>}
              </div>
            )}

            {jobStatus.status === 'done' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving || saveStatus === 'saved'}
                  className="w-full rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : saveStatus === 'saved' ? 'Saved to Library' : 'Save to Library'}
                </button>
                {saveStatus === 'saved' && <p className="text-xs text-green-600 dark:text-green-400">Recording saved successfully.</p>}
                {saveStatus === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
              </div>
            )}
          </div>
        }
      >
        <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
          {jobStatus.status === 'idle' && (
            <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <p className="text-sm text-zinc-500">{canRender ? 'Click Render to process the recording' : 'No recording selected'}</p>
            </div>
          )}

          {isProcessing && (
            <div className="relative w-full aspect-video rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <div className="absolute inset-x-0 bottom-0 space-y-2 p-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{jobStatus.status === 'rendering' ? (jobStatus.total > 0 ? `Rendering — frame ${jobStatus.rendered} of ${jobStatus.total}` : 'Rendering — starting…') : 'Rendering — complete'}</span>
                    <span>{renderProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100" style={{ width: `${renderProgress}%` }} /></div>
                </div>
                {jobStatus.status === 'compositing' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400"><span>Compositing — {composeProgress}%</span><span>{composeProgress}%</span></div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100" style={{ width: `${composeProgress}%` }} /></div>
                  </div>
                )}
              </div>
            </div>
          )}

          {jobStatus.status === 'error' && (
            <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
              <p className="text-sm text-red-500">{jobStatus.message}</p>
            </div>
          )}

          {jobStatus.status === 'done' && (
            <VideoTrimmer videoUrl={jobStatus.videoUrl} fps={DEFAULT_FPS} onTrimChange={handleTrimChange} initialTrimStart={trimStartSec} initialTrimEnd={trimEndSec} />
          )}
        </div>
      </PageLayout>
      <PageNav back={{ label: 'Merchant Customization', href: '/merchant' }} forward={{ label: 'Final Rendering', href: '/review' }} />
    </>
  )
}
