'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import MediaPlayer from '@/app/components/MediaPlayer'
import Select from '@/app/components/Select'
import { ADMIN_PREVIEW_BRANDS, TARGET_URL, type AdminPreviewBrand } from '@/app/config'
import { useUser } from '@/app/contexts/UserContext'
import { DEFAULT_WEBCAM_SETTINGS } from '@/types/webcam'
import type { JobProgress, JobStep } from '@/lib/queue/progress'

const POLL_MS = 500

// 4 cols × 3 rows = 12 cells. Controls card sits at the bottom-left
// (row 3, col 1 in row-major flow → index 8). The other 11 cells render
// ADMIN_PREVIEW_BRANDS in order around it.
const GRID_COLS = 4
const GRID_ROWS = 3
const CONTROLS_SLOT_INDEX = 8

type Recording = {
  id: string
  name: string | null
  product_name: string | null
}

type SlotJob = {
  videoUrl: string | null
  loading: JobStep[] | null
  error: string | null
}

function initialLoadingStages(): JobStep[] {
  return [
    { label: 'Rendering', progress: 0 },
    { label: 'Compositing', progress: 0 },
  ]
}

function recordingLabel(r: Recording): string {
  return r.name ?? r.product_name ?? r.id.slice(0, 8)
}

function blankSlotJobs(): Record<AdminPreviewBrand, SlotJob> {
  const init = {} as Record<AdminPreviewBrand, SlotJob>
  for (const brand of ADMIN_PREVIEW_BRANDS) {
    init[brand] = { videoUrl: null, loading: null, error: null }
  }
  return init
}

export default function PreviewGridClient() {
  const { presenter } = useUser()

  const [recordings, setRecordings] = useState<Recording[]>([])
  const [recordingsError, setRecordingsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [slotJobs, setSlotJobs] = useState<Record<AdminPreviewBrand, SlotJob>>(blankSlotJobs)

  const videoRefs = useRef<Record<AdminPreviewBrand, React.RefObject<HTMLVideoElement | null>>>(
    Object.fromEntries(
      ADMIN_PREVIEW_BRANDS.map((b) => [b, { current: null }]),
    ) as Record<AdminPreviewBrand, React.RefObject<HTMLVideoElement | null>>,
  )
  const activeJobsRef = useRef<Map<string, AdminPreviewBrand>>(new Map())
  // Bumped on each product change so in-flight produce calls can detect
  // they're stale and discard their result instead of overwriting the fresh
  // batch.
  const generationRef = useRef(0)
  // True only while handlePlayAll is mid-flight. Read by each tile's onPlay
  // handler to decide whether a `play` event came from Play All (keep the
  // assigned mute state) or from a native-controls click (force unmute).
  const playingAllRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/recordings?type=product')
        const data = (await res.json()) as { recordings?: Recording[]; error?: string }
        if (cancelled) return
        if (!res.ok) {
          setRecordingsError(data.error ?? 'Failed to load recordings.')
          return
        }
        setRecordings(data.recordings ?? [])
      } catch {
        if (!cancelled) setRecordingsError('Failed to load recordings.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const interval = setInterval(async () => {
      const jobs = [...activeJobsRef.current.entries()]
      if (jobs.length === 0) return
      await Promise.all(
        jobs.map(async ([jobId, brand]) => {
          try {
            const res = await fetch(`/api/jobs/${jobId}`)
            if (!res.ok) return
            const job = (await res.json()) as JobProgress
            if (job.status === 'done' && job.videoUrl) {
              activeJobsRef.current.delete(jobId)
              setSlotJobs((prev) => ({ ...prev, [brand]: { videoUrl: job.videoUrl!, loading: null, error: null } }))
            } else if (job.status === 'error') {
              activeJobsRef.current.delete(jobId)
              setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: null, error: job.message ?? 'Failed.' } }))
            } else if (job.status === 'running') {
              setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: job.steps } }))
            }
          } catch { /* transient */ }
        }),
      )
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const generateBrand = useCallback(async (recordingId: string, productName: string, brand: AdminPreviewBrand, generation: number) => {
    const url = `${TARGET_URL}?product=${encodeURIComponent(productName)}&brand=${encodeURIComponent(brand)}`
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId: recordingId,
          presenter,
          product: productName,
          url,
          webcamMode: DEFAULT_WEBCAM_SETTINGS.webcamMode,
          webcamVertical: DEFAULT_WEBCAM_SETTINGS.webcamVertical,
          webcamHorizontal: DEFAULT_WEBCAM_SETTINGS.webcamHorizontal,
          trimStartSec: 0,
          trimEndSec: 0,
          preview: true,
          priority: 3,
        }),
      })
      const data = (await res.json()) as { jobId?: string; videoUrl?: string; error?: string }
      if (generation !== generationRef.current) return
      if (data.videoUrl) {
        setSlotJobs((prev) => ({ ...prev, [brand]: { videoUrl: data.videoUrl!, loading: null, error: null } }))
        return
      }
      if (!res.ok || !data.jobId) {
        setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: null, error: data.error ?? 'Failed.' } }))
        return
      }
      activeJobsRef.current.set(data.jobId, brand)
    } catch {
      if (generation !== generationRef.current) return
      setSlotJobs((prev) => ({ ...prev, [brand]: { ...prev[brand], loading: null, error: 'Unexpected error.' } }))
    }
  }, [presenter])

  function handleSelectRecording(recordingId: string) {
    setSelectedId(recordingId)
    if (!recordingId) {
      generationRef.current += 1
      activeJobsRef.current.clear()
      setSlotJobs(blankSlotJobs())
      return
    }
    const rec = recordings.find((r) => r.id === recordingId)
    if (!rec) return
    const productName = rec.product_name ?? rec.name ?? ''
    if (!productName) {
      setSlotJobs(() => {
        const next = {} as Record<AdminPreviewBrand, SlotJob>
        for (const b of ADMIN_PREVIEW_BRANDS) next[b] = { videoUrl: null, loading: null, error: 'Recording has no product name.' }
        return next
      })
      return
    }
    const generation = ++generationRef.current
    activeJobsRef.current.clear()
    setSlotJobs(() => {
      const next = {} as Record<AdminPreviewBrand, SlotJob>
      for (const b of ADMIN_PREVIEW_BRANDS) next[b] = { videoUrl: null, loading: initialLoadingStages(), error: null }
      return next
    })
    ADMIN_PREVIEW_BRANDS.forEach((brand) => generateBrand(rec.id, productName, brand, generation))
  }

  function collectVideos(): HTMLVideoElement[] {
    const out: HTMLVideoElement[] = []
    for (const brand of ADMIN_PREVIEW_BRANDS) {
      const v = videoRefs.current[brand].current
      if (v) out.push(v)
    }
    return out
  }

  // Sync rationale: the unmuted leader engages the audio output pipeline,
  // which costs tens of ms compared to muted-only videos. Firing all play()
  // calls simultaneously makes the audio leader visibly trail the rest.
  // Instead, start the leader first and wait for its 'playing' event (audio
  // engaged + first frame on screen); then start every muted follower at the
  // leader's exact currentTime so they all share the same wall-clock origin.
  async function syncedPlay() {
    const videos = collectVideos()
    if (videos.length === 0) return
    const [leader, ...followers] = videos

    playingAllRef.current = true
    for (const v of videos) v.pause()
    leader.muted = false
    for (const v of followers) v.muted = true

    // Don't await leader.play() — the 'playing' event is the real signal.
    // We need to keep playingAllRef true until followers have been kicked
    // off so handleVideoPlay leaves their mute state alone.
    const followersStarted = new Promise<void>((resolve) => {
      const onPlaying = () => {
        const t = leader.currentTime
        // First pass: sync audio + position on every follower. Doing this
        // before any play() call lets the browser kick off all seeks in
        // parallel — interleaving currentTime/play per-video made each
        // play() wait on its own seek and produced a visible wave.
        for (const v of followers) {
          v.muted = true
          v.currentTime = t
        }
        // Second pass: fire every play() back-to-back so they start as
        // close to the same wall-clock instant as the runtime allows.
        for (const v of followers) v.play().catch(() => {})
        resolve()
      }
      leader.addEventListener('playing', onPlaying, { once: true })
    })

    leader.play().catch(() => {})
    try {
      await followersStarted
    } finally {
      playingAllRef.current = false
    }
  }

  function handlePlayAll() {
    void syncedPlay()
  }

  function handlePauseAll() {
    for (const v of collectVideos()) v.pause()
  }

  function handleResetAll() {
    for (const v of collectVideos()) {
      v.pause()
      v.currentTime = 0
    }
  }

  function handleVideoPlay(e: React.SyntheticEvent<HTMLVideoElement>) {
    // During Play All the leader/follower mute pattern is already applied
    // — leave it alone. For an individual play, unmute the played tile and
    // mute every other so the prior leader doesn't echo.
    if (playingAllRef.current) return
    const target = e.currentTarget
    for (const brand of ADMIN_PREVIEW_BRANDS) {
      const v = videoRefs.current[brand].current
      if (!v) continue
      v.muted = v !== target
    }
  }

  const allDone = selectedId !== '' && ADMIN_PREVIEW_BRANDS.every((b) => !!slotJobs[b].videoUrl)

  // Render-order: 8 video tiles, controls card, then the remaining 3 video
  // tiles. Row-major flow over a 4×3 grid puts the controls at index 8 =
  // row 3, col 1 (bottom-left). 11 video tiles + 1 controls = 12 cells.
  const cells: React.ReactNode[] = []
  const totalCells = GRID_COLS * GRID_ROWS
  for (let i = 0; i < totalCells; i++) {
    if (i === CONTROLS_SLOT_INDEX) {
      cells.push(
        <div
          key="__controls__"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md"
        >
          <div className="border-b border-border px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Controls</h2>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-3 px-4 py-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Product recording</span>
              <Select
                value={selectedId}
                onChange={handleSelectRecording}
                options={recordings.map((r) => ({ value: r.id, label: recordingLabel(r) }))}
                placeholder="Select a recording…"
                size="md"
              />
              {recordingsError && (
                <span className="text-xs text-red-500">{recordingsError}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePlayAll}
                disabled={!allDone}
                className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-80 disabled:opacity-50"
              >
                Play
              </button>
              <button
                onClick={handlePauseAll}
                disabled={!allDone}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-surface disabled:opacity-50"
              >
                Pause
              </button>
              <button
                onClick={handleResetAll}
                disabled={!allDone}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-surface disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          </div>
        </div>,
      )
      continue
    }
    const brandIndex = i < CONTROLS_SLOT_INDEX ? i : i - 1
    const brand = ADMIN_PREVIEW_BRANDS[brandIndex]
    const sj = slotJobs[brand]
    cells.push(
      <div
        key={brand}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md"
      >
        <div className="border-b border-border px-4 py-2">
          <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-muted">{brand}</h2>
        </div>
        {/* Container-query box: sizes the inner div to the largest 16:9 box
            that fits the cell, so the video letterboxes by whichever
            dimension is binding rather than overflowing. */}
        <div className="flex flex-1 items-center justify-center p-2 [container-type:size]">
          <div style={{ width: 'min(100cqw, calc(100cqh * 16 / 9))' }}>
            <MediaPlayer
              videoUrl={sj.videoUrl}
              videoRef={videoRefs.current[brand]}
              loading={sj.loading ? { stages: sj.loading } : undefined}
              error={sj.error}
              emptyMessage={selectedId ? 'Waiting…' : 'Pick a recording'}
              onPlay={handleVideoPlay}
            />
          </div>
        </div>
      </div>,
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background p-[5vh] font-sans">
      <div
        className="grid h-full w-full gap-[10px]"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
        }}
      >
        {cells}
      </div>
    </div>
  )
}
