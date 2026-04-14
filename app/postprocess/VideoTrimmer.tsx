'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  videoUrl: string
  fps: number
  onTrimChange: (startSec: number, endSec: number) => void
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

export default function VideoTrimmer({ videoUrl, fps, onTrimChange }: Props) {
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
        setTrimEnd(d)
        setPlayhead(0)
        video.currentTime = 0
      }
    }
    video.addEventListener('loadedmetadata', onLoaded)
    if (video.duration && Number.isFinite(video.duration)) onLoaded()
    return () => video.removeEventListener('loadedmetadata', onLoaded)
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
      if (playhead < newStart) seekTo(newStart)
      onTrimChange(newStart, trimEnd)
    } else if (dragTarget === 'end') {
      const newEnd = clamp(time, trimStart + frameStep, duration)
      setTrimEnd(newEnd)
      if (playhead > newEnd) seekTo(newEnd)
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
      if (playhead < newStart) seekTo(newStart)
      onTrimChange(newStart, trimEnd)
    } else if (which === 'end') {
      const newEnd = clamp(trimEnd + delta, trimStart + frameStep, duration)
      setTrimEnd(newEnd)
      if (playhead > newEnd) seekTo(newEnd)
      onTrimChange(trimStart, newEnd)
    } else {
      seekTo(playhead + delta)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Video display */}
      <div className="w-full overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          preload="auto"
          className="w-full"
        />
      </div>

      {/* Time display */}
      <div className="flex justify-between text-xs text-zinc-400 font-mono">
        <span>In: {formatTime(trimStart)}</span>
        <span>{formatTime(playhead)}</span>
        <span>Out: {formatTime(trimEnd)}</span>
      </div>

      {/* Timeline track */}
      <div
        ref={trackRef}
        data-track
        className="relative h-6 w-full cursor-pointer select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Full bar — grey (cut/trimmed region) */}
        <div className="absolute inset-x-0 top-[10px] h-[2px] bg-zinc-600" />

        {/* Active region — white (kept region) */}
        <div
          className="absolute top-[10px] h-[2px] bg-white"
          style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd) - pct(trimStart)}%` }}
        />

        {/* Start handle — black square, white border, rounded */}
        <div
          data-handle="start"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, 'start')}
          className="absolute top-[3px] h-4 w-3 -ml-1.5 rounded-sm border border-white bg-black cursor-ew-resize outline-none focus:ring-1 focus:ring-white/50"
          style={{ left: `${pct(trimStart)}%` }}
        />

        {/* End handle — black square, white border, rounded */}
        <div
          data-handle="end"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, 'end')}
          className="absolute top-[3px] h-4 w-3 -ml-1.5 rounded-sm border border-white bg-black cursor-ew-resize outline-none focus:ring-1 focus:ring-white/50"
          style={{ left: `${pct(trimEnd)}%` }}
        />

        {/* Playhead — white circle */}
        <div
          data-handle="playhead"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, 'playhead')}
          className="absolute top-[6px] h-[10px] w-[10px] -ml-[5px] rounded-full bg-white cursor-grab outline-none focus:ring-1 focus:ring-white/50"
          style={{ left: `${pct(playhead)}%` }}
        />
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3">
        {/* Jump to start */}
        <button
          onClick={jumpToStart}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:text-white transition-colors"
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
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-600 text-zinc-300 hover:text-white hover:border-zinc-400 transition-colors"
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
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:text-white transition-colors"
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
