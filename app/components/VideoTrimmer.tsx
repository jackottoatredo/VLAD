'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  videoUrl: string
  fps: number
  onTrimChange: (startSec: number, endSec: number) => void
  initialTrimStart?: number
  initialTrimEnd?: number
}

type DragTarget = 'start' | 'end' | 'playhead' | null

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export default function VideoTrimmer({ videoUrl, fps, onTrimChange, initialTrimStart, initialTrimEnd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)
  const animFrameRef = useRef<number>(0)
  const frameStep = 1 / fps

  // Initialize duration when video metadata loads
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onLoaded = () => {
      const d = video.duration
      if (Number.isFinite(d) && d > 0) {
        setDuration(d)
        const start = initialTrimStart != null && initialTrimStart > 0 && initialTrimStart < d ? initialTrimStart : 0
        const end = initialTrimEnd != null && initialTrimEnd > 0 && initialTrimEnd <= d ? initialTrimEnd : d
        setTrimStart(start)
        setTrimEnd(end)
        setPlayhead(start)
        video.currentTime = start
      }
    }
    video.addEventListener('loadedmetadata', onLoaded)
    if (video.duration && Number.isFinite(video.duration)) onLoaded()
    return () => video.removeEventListener('loadedmetadata', onLoaded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl])

  const pct = useCallback((sec: number) => (duration > 0 ? (sec / duration) * 100 : 0), [duration])

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0
      const rect = track.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      return clamp(ratio * duration, 0, duration)
    },
    [duration],
  )

  const seekTo = useCallback(
    (sec: number) => {
      const clamped = clamp(sec, trimStart, trimEnd)
      setPlayhead(clamped)
      if (videoRef.current) videoRef.current.currentTime = clamped
    },
    [trimStart, trimEnd],
  )

  // Playback loop — sync playhead from video.currentTime
  useEffect(() => {
    if (!isPlaying) return
    const video = videoRef.current
    if (!video) return

    video.play()
    const tick = () => {
      const t = video.currentTime
      if (t >= trimEnd) {
        video.pause()
        video.currentTime = trimEnd
        setPlayhead(trimEnd)
        setIsPlaying(false)
        return
      }
      setPlayhead(t)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      video.pause()
    }
  }, [isPlaying, trimEnd])

  function togglePlay() {
    if (isPlaying) {
      setIsPlaying(false)
    } else {
      // If at trim end, restart from trim start
      if (videoRef.current && playhead >= trimEnd - frameStep) {
        videoRef.current.currentTime = trimStart
        setPlayhead(trimStart)
      }
      setIsPlaying(true)
    }
  }

  function jumpToStart() {
    setIsPlaying(false)
    seekTo(trimStart)
  }

  function jumpToEnd() {
    setIsPlaying(false)
    seekTo(trimEnd)
  }

  // Pointer event handlers on the track container
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setIsPlaying(false)
    const target = (e.target as HTMLElement).dataset.handle as DragTarget
    if (target === 'start' || target === 'end' || target === 'playhead') {
      setDragTarget(target)
    } else {
      // Click on empty track — jump playhead
      const time = timeFromClientX(e.clientX)
      seekTo(time)
      setDragTarget('playhead')
    }
    ;(e.target as HTMLElement).closest('[data-track]')?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragTarget) return
    const time = timeFromClientX(e.clientX)

    if (dragTarget === 'start') {
      const newStart = clamp(time, 0, trimEnd - frameStep)
      setTrimStart(newStart)
      setPlayhead(newStart)
      if (videoRef.current) videoRef.current.currentTime = newStart
      onTrimChange(newStart, trimEnd)
    } else if (dragTarget === 'end') {
      const newEnd = clamp(time, trimStart + frameStep, duration)
      setTrimEnd(newEnd)
      setPlayhead(newEnd)
      if (videoRef.current) videoRef.current.currentTime = newEnd
      onTrimChange(trimStart, newEnd)
    } else if (dragTarget === 'playhead') {
      seekTo(time)
    }
  }

  function handlePointerUp() {
    setDragTarget(null)
  }

  // Arrow key nudging
  function handleKeyDown(e: React.KeyboardEvent, which: 'start' | 'end' | 'playhead') {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setIsPlaying(false)
    const delta = e.key === 'ArrowRight' ? frameStep : -frameStep

    if (which === 'start') {
      const newStart = clamp(trimStart + delta, 0, trimEnd - frameStep)
      setTrimStart(newStart)
      setPlayhead(newStart)
      if (videoRef.current) videoRef.current.currentTime = newStart
      onTrimChange(newStart, trimEnd)
    } else if (which === 'end') {
      const newEnd = clamp(trimEnd + delta, trimStart + frameStep, duration)
      setTrimEnd(newEnd)
      setPlayhead(newEnd)
      if (videoRef.current) videoRef.current.currentTime = newEnd
      onTrimChange(trimStart, newEnd)
    } else {
      seekTo(playhead + delta)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Video display */}
      <div className="w-full overflow-hidden rounded-lg bg-background">
        <video
          ref={videoRef}
          src={videoUrl}
          preload="auto"
          className="w-full"
        />
      </div>

      {/* Time display */}
      <div className="flex justify-between text-xs text-muted font-mono">
        <span>Start: {formatTime(trimStart)}</span>
        <span>{formatTime(playhead)}</span>
        <span>End: {formatTime(trimEnd)}</span>
      </div>

      {/* Timeline track */}
      <div
        ref={trackRef}
        data-track
        className="relative h-5 w-full cursor-pointer select-none bg-background"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Full video bounds — grey outline */}
        <div className="pointer-events-none absolute inset-0 rounded-md border border-border" />

        {/* Clip region (kept) — spans between the inner edges of the two handles */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 border-y border-accent bg-accent-soft"
          style={{
            left: `calc(${pct(trimStart)}% + 8px)`,
            width: `calc(${pct(trimEnd) - pct(trimStart)}% - 16px)`,
          }}
        />

        {/* Start handle — overlaps the left edge of the clip */}
        <div
          data-handle="start"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, 'start')}
          className="absolute top-0 bottom-0 flex w-2 items-center justify-center rounded-l-md bg-accent cursor-ew-resize outline-none focus:ring-1 focus:ring-foreground/50"
          style={{ left: `${pct(trimStart)}%` }}
        >
          <span className="pointer-events-none block h-[calc(100%-8px)] w-0.5 rounded-full bg-background/60" />
        </div>

        {/* End handle — overlaps the right edge of the clip */}
        <div
          data-handle="end"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, 'end')}
          className="absolute top-0 bottom-0 flex w-2 items-center justify-center rounded-r-md bg-accent cursor-ew-resize outline-none focus:ring-1 focus:ring-foreground/50"
          style={{ left: `${pct(trimEnd)}%`, transform: 'translateX(-100%)' }}
        >
          <span className="pointer-events-none block h-[calc(100%-8px)] w-0.5 rounded-full bg-background/60" />
        </div>

        {/* Playhead — line drawn on top of handles, with circle bump */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-[2px] -ml-px bg-foreground"
          style={{ left: `${pct(playhead)}%` }}
        >
          <div
            data-handle="playhead"
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, 'playhead')}
            className="pointer-events-auto absolute left-1/2 -top-[2.5px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-foreground cursor-grab outline-none focus:ring-1 focus:ring-foreground/50"
          />
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-1 -mt-1.5">
        {/* Jump to start */}
        <button
          onClick={jumpToStart}
          className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-foreground transition-colors"
          title="Jump to start"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="2" width="2" height="10" />
            <path d="M12 2 L5 7 L12 12 Z" />
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          className="flex h-8 w-8 items-center justify-center text-muted hover:text-foreground transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="1" width="3" height="10" />
              <rect x="7" y="1" width="3" height="10" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 0 L12 6 L2 12 Z" />
            </svg>
          )}
        </button>

        {/* Jump to end */}
        <button
          onClick={jumpToEnd}
          className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-foreground transition-colors"
          title="Jump to end"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2 2 L9 7 L2 12 Z" />
            <rect x="11" y="2" width="2" height="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
