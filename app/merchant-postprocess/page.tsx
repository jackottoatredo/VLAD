'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import VideoTrimmer from '@/app/postprocess/VideoTrimmer'
import { DEFAULT_FPS } from '@/app/config'

const JOB_POLL_INTERVAL_MS = 500

type JobStatus =
  | { status: 'idle' }
  | { status: 'rendering'; rendered: number; total: number }
  | { status: 'compositing'; composited: number; total: number }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }

type RecordingEntry = { name: string; presenter: string; recordedAt: string }

export default function MerchantPostprocessPage() {
  // Session selection
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [selectedPresenter, setSelectedPresenter] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const [isLoadingList, setIsLoadingList] = useState(true)

  // Job state
  const [jobStatus, setJobStatus] = useState<JobStatus>({ status: 'idle' })
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const jobIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const merchantIdRef = useRef<string>('')

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrimStart(start)
    setTrimEnd(end)
  }, [])

  // Load available recordings on mount — auto-select the most recent
  useEffect(() => {
    fetch('/api/list-recordings')
      .then((r) => r.json())
      .then((data: { recordings: RecordingEntry[] }) => {
        setRecordings(data.recordings)
        if (data.recordings.length > 0) {
          setSelectedPresenter(data.recordings[0].presenter)
          setSelectedSession(data.recordings[0].name)
        }
        setIsLoadingList(false)
      })
      .catch(() => { setIsLoadingList(false) })
  }, [])

  // Start the render job automatically when session selection changes
  useEffect(() => {
    if (!selectedPresenter || !selectedSession) return
    setJobStatus({ status: 'rendering', rendered: 0, total: 0 })
    setTrimStart(0)
    setTrimEnd(0)
    jobIdRef.current = null

    let cancelled = false
    ;(async () => {
      try {
        // Read merchant URL from metadata to build the correct target URL
        const metaRes = await fetch(`/api/session-metadata?presenter=${selectedPresenter}&session=${selectedSession}`)
        const meta = (await metaRes.json()) as { merchantUrl?: string }
        if (cancelled) return

        // Extract merchantId from session name (format: {presenter}_{merchantId})
        const parts = selectedSession.split('_')
        merchantIdRef.current = parts.length > 2 ? parts.slice(2).join('_') : parts[parts.length - 1]

        // Use brand-based target URL: search.redo.com/record?brand=mammut.com
        const merchantUrl = meta.merchantUrl ?? ''
        const targetUrl = merchantUrl
          ? `http://search.redo.com/record?brand=${encodeURIComponent(merchantUrl)}`
          : 'http://search.redo.com/record'

        const res = await fetch('/api/composite-postprocess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presenter: selectedPresenter, session: selectedSession, targetUrl }),
        })
        if (cancelled) return
        const data = (await res.json()) as { jobId?: string; error?: string }
        if (!res.ok || !data.jobId) {
          setJobStatus({ status: 'error', message: data.error ?? 'Failed to start processing.' })
          return
        }
        jobIdRef.current = data.jobId
      } catch {
        if (!cancelled) setJobStatus({ status: 'error', message: 'Unexpected error starting processing.' })
      }
    })()

    return () => { cancelled = true }
  }, [selectedPresenter, selectedSession])

  // Poll for job progress
  useEffect(() => {
    pollingRef.current = setInterval(async () => {
      const jobId = jobIdRef.current
      if (!jobId) return

      try {
        const res = await fetch(`/api/render-progress/${jobId}`)
        const job = (await res.json()) as {
          status: string
          rendered?: number
          composited?: number
          total?: number
          videoUrl?: string
          message?: string
        }

        if (job.status === 'done' && job.videoUrl) {
          jobIdRef.current = null
          setJobStatus({ status: 'done', videoUrl: job.videoUrl })
        } else if (job.status === 'error') {
          jobIdRef.current = null
          setJobStatus({ status: 'error', message: job.message ?? 'Processing failed.' })
        } else if (job.status === 'rendering') {
          setJobStatus({ status: 'rendering', rendered: job.rendered ?? 0, total: job.total ?? 0 })
        } else if (job.status === 'compositing') {
          setJobStatus({ status: 'compositing', composited: job.composited ?? 0, total: job.total ?? 0 })
        }
      } catch {
        // transient error — keep polling
      }
    }, JOB_POLL_INTERVAL_MS)

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  async function handleSaveAndContinue() {
    if (!selectedPresenter || !selectedSession) return
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      // Save trim marks to local metadata
      await fetch('/api/save-trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter: selectedPresenter,
          session: selectedSession,
          trimStartSec: trimStart,
          trimEndSec: trimEnd,
        }),
      })

      // Save recording to library (Supabase + R2)
      const saveRes = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presenter: selectedPresenter,
          session: selectedSession,
          type: 'merchant',
          merchantId: merchantIdRef.current,
        }),
      })
      const saveData = (await saveRes.json()) as { ok?: boolean; error?: string }
      if (!saveRes.ok || !saveData.ok) {
        setSaveStatus('error')
        setSaveError(saveData.error ?? 'Failed to save to library.')
        setIsSaving(false)
        return
      }

      setSaveStatus('saved')
      setIsSaving(false)
    } catch {
      setSaveStatus('error')
      setSaveError('Unexpected error.')
      setIsSaving(false)
    }
  }

  const isProcessing = jobStatus.status === 'rendering' || jobStatus.status === 'compositing'

  const renderProgress =
    jobStatus.status === 'rendering' && jobStatus.total > 0
      ? Math.round((jobStatus.rendered / jobStatus.total) * 100)
      : jobStatus.status === 'compositing' || jobStatus.status === 'done' ? 100 : 0

  const composeProgress =
    jobStatus.status === 'compositing' && jobStatus.total > 0
      ? Math.round((jobStatus.composited / jobStatus.total) * 100)
      : jobStatus.status === 'done' ? 100 : 0

  const presenters = [...new Set(recordings.map((r) => r.presenter))].sort()
  const sessionsForPresenter = recordings
    .filter((r) => r.presenter === selectedPresenter)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))

  return (
    <>
      <PageLayout
        instructions={
          <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <p>Review your merchant recording and trim any dead air from the start and end.</p>
            <p>Drag the green handles to set in/out points, or use arrow keys for frame-by-frame precision.</p>
            <p>When you are satisfied, click &ldquo;Save Trim &amp; Continue&rdquo; to proceed to review.</p>
          </div>
        }
        settings={
          <div className="flex flex-col gap-3">
            <select
              value={selectedPresenter}
              onChange={(e) => {
                const p = e.target.value
                setSelectedPresenter(p)
                const first = recordings.find((r) => r.presenter === p)
                setSelectedSession(first?.name ?? '')
                setJobStatus({ status: 'idle' })
              }}
              disabled={isLoadingList || isProcessing}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {isLoadingList && <option value="">Loading…</option>}
              {!isLoadingList && presenters.length === 0 && <option value="">No presenters yet</option>}
              {presenters.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <select
              value={selectedSession}
              onChange={(e) => {
                setSelectedSession(e.target.value)
                setJobStatus({ status: 'idle' })
              }}
              disabled={isLoadingList || isProcessing || sessionsForPresenter.length === 0}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {sessionsForPresenter.length === 0 && <option value="">No sessions</option>}
              {sessionsForPresenter.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {new Date(r.recordedAt).toLocaleString()}
                </option>
              ))}
            </select>

            {jobStatus.status === 'done' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSaveAndContinue}
                  disabled={isSaving || saveStatus === 'saved'}
                  className="w-full rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : saveStatus === 'saved' ? 'Saved to Library' : 'Save to Library'}
                </button>
                {saveStatus === 'saved' && (
                  <p className="text-xs text-green-600 dark:text-green-400">Recording saved successfully.</p>
                )}
                {saveStatus === 'error' && (
                  <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
                )}
              </div>
            )}
          </div>
        }
      >
        <div className="flex flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
          {jobStatus.status === 'idle' && (
            <div className="flex w-full aspect-video items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <p className="text-sm text-zinc-500">Select a recording to begin processing</p>
            </div>
          )}

          {isProcessing && (
            <div className="relative w-full aspect-video rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <div className="absolute inset-x-0 bottom-0 space-y-2 p-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      {jobStatus.status === 'rendering'
                        ? jobStatus.total > 0
                          ? `Rendering — frame ${jobStatus.rendered} of ${jobStatus.total}`
                          : 'Rendering — starting…'
                        : 'Rendering — complete'}
                    </span>
                    <span>{renderProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div
                      className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                </div>

                {jobStatus.status === 'compositing' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Compositing — {composeProgress}%</span>
                      <span>{composeProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
                        style={{ width: `${composeProgress}%` }}
                      />
                    </div>
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
            <VideoTrimmer
              videoUrl={jobStatus.videoUrl}
              fps={DEFAULT_FPS}
              onTrimChange={handleTrimChange}
            />
          )}
        </div>
      </PageLayout>
      <PageNav
        back={{ label: 'Merchant Customization', href: '/merchant' }}
        forward={{ label: 'Final Rendering', href: '/review' }}
      />
    </>
  )
}
