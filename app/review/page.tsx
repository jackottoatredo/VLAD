'use client'

import { useEffect, useRef, useState } from 'react'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import WebcamControls from '@/app/components/WebcamControls'
import { type WebcamSettings, DEFAULT_WEBCAM_SETTINGS } from '@/types/webcam'

type RecordingEntry = {
  name: string
  presenter: string
  recordedAt: string
}

type PageState =
  | { status: 'loading-list' | 'ready' }
  | { status: 'rendering'; jobId: string; rendered: number; total: number }
  | { status: 'compositing'; jobId: string; composited: number; total: number }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }

const JOB_POLL_INTERVAL_MS = 500

export default function ReviewPage() {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [selectedPresenter, setSelectedPresenter] = useState<string>('')
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [state, setState] = useState<PageState>({ status: 'loading-list' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [recordedSettings, setRecordedSettings] = useState<WebcamSettings>(DEFAULT_WEBCAM_SETTINGS)
  const [webcamSettings, setWebcamSettings] = useState<WebcamSettings>(DEFAULT_WEBCAM_SETTINGS)
  const [useRecordingSettings, setUseRecordingSettings] = useState(true)

  useEffect(() => {
    fetch('/api/list-recordings')
      .then((r) => r.json())
      .then((data: { recordings: RecordingEntry[] }) => {
        setRecordings(data.recordings)
        if (data.recordings.length > 0) {
          setSelectedPresenter(data.recordings[0].presenter)
          setSelectedSession(data.recordings[0].name)
        }
        setState({ status: 'ready' })
      })
      .catch(() => setState({ status: 'error', message: 'Failed to load session list.' }))
  }, [])

  useEffect(() => {
    if (!selectedPresenter || !selectedSession) return
    fetch(`/api/session-metadata?presenter=${selectedPresenter}&session=${selectedSession}`)
      .then((r) => r.json())
      .then((data: { webcamMode?: string; webcamVertical?: string; webcamHorizontal?: string }) => {
        const loaded: WebcamSettings = {
          webcamMode: (data.webcamMode as WebcamSettings['webcamMode']) ?? DEFAULT_WEBCAM_SETTINGS.webcamMode,
          webcamVertical: (data.webcamVertical as WebcamSettings['webcamVertical']) ?? DEFAULT_WEBCAM_SETTINGS.webcamVertical,
          webcamHorizontal: (data.webcamHorizontal as WebcamSettings['webcamHorizontal']) ?? DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
        }
        setRecordedSettings(loaded)
        setWebcamSettings(loaded)
        setUseRecordingSettings(true)
      })
      .catch(() => {})
  }, [selectedPresenter, selectedSession])

  useEffect(() => {
    const isActive = state.status === 'rendering' || state.status === 'compositing'
    if (!isActive) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    const { jobId } = state
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/render-progress/${jobId}`)
        const job = await res.json() as {
          status: string
          rendered?: number
          total?: number
          composited?: number
          videoUrl?: string
          message?: string
        }
        if (job.status === 'done' && job.videoUrl) {
          setState({ status: 'done', videoUrl: job.videoUrl })
        } else if (job.status === 'error') {
          setState({ status: 'error', message: job.message ?? 'Render failed.' })
        } else if (job.status === 'rendering') {
          setState((prev) =>
            prev.status === 'rendering'
              ? { ...prev, rendered: job.rendered ?? 0, total: job.total ?? 0 }
              : prev
          )
        } else if (job.status === 'compositing') {
          setState((prev) =>
            prev.status === 'rendering' || prev.status === 'compositing'
              ? { status: 'compositing', jobId, composited: job.composited ?? 0, total: job.total ?? 0 }
              : prev
          )
        }
      } catch {
        // transient fetch error — keep polling
      }
    }, JOB_POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [state.status === 'rendering' || state.status === 'compositing' ? (state as { jobId: string }).jobId : null]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRender() {
    if (!selectedPresenter || !selectedSession) return
    try {
      const response = await fetch('/api/render-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: selectedSession,
          presenter: selectedPresenter,
          webcamMode: webcamSettings.webcamMode,
          webcamVertical: webcamSettings.webcamVertical,
          webcamHorizontal: webcamSettings.webcamHorizontal,
        }),
      })
      const payload = (await response.json()) as { jobId?: string; error?: string }
      if (!response.ok || !payload.jobId) {
        setState({ status: 'error', message: payload.error ?? 'Failed to start render.' })
        return
      }
      setState({ status: 'rendering', jobId: payload.jobId, rendered: 0, total: 0 })
    } catch {
      setState({ status: 'error', message: 'Unexpected error. Check server logs.' })
    }
  }

  const isLoadingList = state.status === 'loading-list'
  const isWorking = state.status === 'rendering' || state.status === 'compositing'
  const canRender = !isLoadingList && !isWorking && !!selectedPresenter && !!selectedSession

  const presenters = [...new Set(recordings.map((r) => r.presenter))].sort()
  const sessionsForPresenter = recordings
    .filter((r) => r.presenter === selectedPresenter)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))

  const renderProgress =
    state.status === 'rendering' && state.total > 0
      ? Math.round((state.rendered / state.total) * 100)
      : state.status === 'compositing' || state.status === 'done'
      ? 100
      : 0

  const composeProgress =
    state.status === 'compositing' && state.total > 0
      ? Math.round((state.composited / state.total) * 100)
      : state.status === 'done'
      ? 100
      : 0

  return (
    <>
      <PageLayout
        instructions={
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
        }
        settings={
          <>
            <select
              value={selectedPresenter}
              onChange={(e) => {
                const presenter = e.target.value
                setSelectedPresenter(presenter)
                const first = recordings.find((r) => r.presenter === presenter)
                setSelectedSession(first?.name ?? '')
                setState({ status: 'ready' })
              }}
              disabled={isLoadingList || isWorking}
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
                setState({ status: 'ready' })
              }}
              disabled={isLoadingList || isWorking || sessionsForPresenter.length === 0}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {sessionsForPresenter.length === 0 && <option value="">No sessions</option>}
              {sessionsForPresenter.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {new Date(r.recordedAt).toLocaleString()}
                </option>
              ))}
            </select>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={useRecordingSettings}
                  onChange={(e) => {
                    setUseRecordingSettings(e.target.checked)
                    if (e.target.checked) setWebcamSettings(recordedSettings)
                  }}
                  disabled={isWorking}
                  className="rounded border-zinc-300 dark:border-zinc-700"
                />
                Use recording settings
              </label>
              {!useRecordingSettings && (
                <WebcamControls
                  settings={webcamSettings}
                  onChange={setWebcamSettings}
                  disabled={isWorking}
                />
              )}
            </div>

            <button
              onClick={handleRender}
              disabled={!canRender}
              className="w-full rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {state.status === 'rendering' ? 'Rendering…' : state.status === 'compositing' ? 'Compositing…' : 'Render'}
            </button>

            {state.status === 'error' && (
              <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
            )}

            {(isWorking || state.status === 'done') && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      {state.status === 'rendering'
                        ? state.total > 0
                          ? `Rendering — frame ${state.rendered} of ${state.total}`
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

                {(state.status === 'compositing' || state.status === 'done') && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                      <span>
                        {state.status === 'compositing'
                          ? state.total > 0
                            ? `Compositing — step ${state.composited} of ${state.total}`
                            : 'Compositing — starting…'
                          : 'Compositing — complete'}
                      </span>
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
            )}

            {state.status === 'done' && (
              <a
                href={state.videoUrl}
                download
                className="flex w-full items-center justify-center rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Download MP4
              </a>
            )}
          </>
        }
      >
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-300 p-[10px] dark:border-zinc-700">
          {state.status === 'done' ? (
            <video src={state.videoUrl} controls className="w-full max-h-full rounded-lg" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-300 dark:text-zinc-700">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="h-16 w-16">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0 1 18 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 0 1 6 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M4.875 15h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
              </svg>
              <p className="text-sm">No video rendered yet</p>
            </div>
          )}
        </div>
      </PageLayout>
      <PageNav back={{ label: 'Merchant Postprocessing', href: '/merchant-postprocess' }} />
    </>
  )
}
