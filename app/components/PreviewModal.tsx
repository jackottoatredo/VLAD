'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

type Props = {
  title: string
  videoUrl?: string | null
  downloadName?: string
  /** Clip playback to this range (seconds). When end is 0 or undefined, no upper bound. */
  trimStartSec?: number
  trimEndSec?: number
  onClose: () => void
  onDelete?: () => void
  onEdit?: () => void
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PreviewModal({
  title,
  videoUrl,
  downloadName,
  trimStartSec,
  trimEndSec,
  onClose,
  onDelete,
  onEdit,
}: Props) {
  const [copied, setCopied] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Stream from our API for playback (authed, no presign needed)
  const streamUrl = videoUrl ? `/api/stream?key=${encodeURIComponent(videoUrl)}` : null
  const downloadUrl = videoUrl
    ? `/api/stream?key=${encodeURIComponent(videoUrl)}${downloadName ? `&filename=${encodeURIComponent(downloadName)}` : ''}`
    : null

  const clipStart = typeof trimStartSec === 'number' && trimStartSec > 0 ? trimStartSec : 0
  const clipEndRaw = typeof trimEndSec === 'number' && trimEndSec > 0 ? trimEndSec : 0
  const effectiveEnd = clipEndRaw > 0 ? clipEndRaw : (duration > 0 ? duration : 0)
  const hasTrim = clipStart > 0 || clipEndRaw > 0
  const clipDuration = effectiveEnd > clipStart ? effectiveEnd - clipStart : 0
  const relativeTime = Math.max(0, Math.min(clipDuration, currentTime - clipStart))
  const progress = clipDuration > 0 ? relativeTime / clipDuration : 0

  // Sync video element state + enforce the clipping window.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !streamUrl) return

    const onLoaded = () => {
      setDuration(v.duration || 0)
      if (clipStart > 0 && v.currentTime < clipStart) v.currentTime = clipStart
      setCurrentTime(v.currentTime)
    }
    const onTimeUpdate = () => {
      if (clipEndRaw > 0 && v.currentTime >= clipEndRaw) {
        v.pause()
        v.currentTime = clipEndRaw
      } else if (clipStart > 0 && v.currentTime < clipStart) {
        v.currentTime = clipStart
      }
      setCurrentTime(v.currentTime)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onEnded)
    }
  }, [streamUrl, clipStart, clipEndRaw])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      // If at/past the clip end, rewind to the clip start for replay.
      const atEnd = effectiveEnd > 0 && v.currentTime >= effectiveEnd - 0.05
      if (atEnd) v.currentTime = clipStart
      else if (clipStart > 0 && v.currentTime < clipStart) v.currentTime = clipStart
      void v.play()
    } else {
      v.pause()
    }
  }

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current
    if (!v || clipDuration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const target = clipStart + ratio * clipDuration
    v.currentTime = Math.max(clipStart, Math.min(effectiveEnd > 0 ? effectiveEnd : v.duration, target))
    setCurrentTime(v.currentTime)
  }

  async function handleCopy() {
    if (!videoUrl) return
    try {
      const res = await fetch(`/api/presign?key=${encodeURIComponent(videoUrl)}`)
      const data = await res.json()
      if (data.url) {
        await navigator.clipboard.writeText(data.url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-background">
        {streamUrl ? (
          hasTrim ? (
            <div className="relative h-full w-full">
              <video
                ref={videoRef}
                src={streamUrl}
                onClick={togglePlay}
                className="h-full w-full cursor-pointer object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
                <button
                  onClick={togglePlay}
                  className="text-white transition-opacity hover:opacity-80"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>
                  )}
                </button>
                <div
                  onClick={seekFromEvent}
                  className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/25"
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <span className="shrink-0 tabular-nums text-xs text-white">
                  {formatTime(relativeTime)} / {formatTime(clipDuration)}
                </span>
              </div>
            </div>
          ) : (
            <video ref={videoRef} src={streamUrl} controls className="h-full w-full object-contain" />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-muted">Media preview coming soon</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-4">
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-muted transition-colors hover:text-foreground"
            title="Open in editor"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
        )}
        {videoUrl && (
          <button
            onClick={handleCopy}
            className={`transition-colors ${copied ? 'text-green-500' : 'text-muted hover:text-foreground'}`}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
          </button>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={downloadName ? `${downloadName}.mp4` : true}
            className="text-muted transition-colors hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-muted transition-colors hover:text-red-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>
    </Modal>
  )
}
