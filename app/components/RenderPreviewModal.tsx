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
  /** When present, enables the share-link / GIF actions on the Share tab. */
  slug?: string | null
  onClose: () => void
  onDelete?: () => void
}

type Tab = 'preview' | 'share'

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RenderPreviewModal({
  title,
  videoUrl,
  downloadName,
  trimStartSec,
  trimEndSec,
  slug,
  onClose,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>('preview')
  const [linkCopied, setLinkCopied] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

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

  // The video element is unmounted when the user switches to the Share tab,
  // so the listeners must reattach when they return. Re-running on `tab`
  // handles that.
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
  }, [streamUrl, clipStart, clipEndRaw, tab])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
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

  async function copyShareLink() {
    if (!slug) return
    try {
      const url = `${window.location.origin}/v/${slug}`
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  // The Clipboard API doesn't accept image/gif (deliberate spec restriction
  // in Chromium and Safari), so a true "copy GIF to clipboard" path is not
  // available. Just download the file and let the user drag it into their
  // email composer. No flash UI — the browser's own download chrome is the
  // confirmation.
  function downloadGif() {
    if (!slug) return
    const a = document.createElement('a')
    a.href = `/v/${slug}/download-gif`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function downloadVideo() {
    if (!downloadUrl) return
    const a = document.createElement('a')
    a.href = downloadUrl
    if (downloadName) a.download = `${downloadName}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const tabs = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1">
      {(['preview', 'share'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`rounded-md px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors ${
            tab === t
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted hover:text-foreground'
          }`}
        >
          {t === 'preview' ? 'Preview' : 'Share'}
        </button>
      ))}
    </div>
  )

  return (
    <Modal onClose={onClose} size="lg" title={tabs}>
      {tab === 'preview' ? (
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
      ) : (
        <div className="aspect-video w-full">
          {!slug ? (
            <p className="flex h-full items-center justify-center rounded-lg border border-border bg-background p-4 text-sm text-muted">
              Sharing isn&apos;t available for this render yet.
            </p>
          ) : (
            <div className="flex h-full flex-col gap-2">
              <ShareCard
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                }
                name="Share link"
                description="Copy a link with a rich preview — works great on WhatsApp, iMessage, LinkedIn, Telegram, Facebook, and any platform that reads OpenGraph."
                actionLabel={linkCopied ? 'Copied ✓' : 'Copy link'}
                actionActive={linkCopied}
                onAction={copyShareLink}
              />
              <ShareCard
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                }
                name="Email GIF embed"
                description="Download the GIF, drag it into your email, right-click to add a hyperlink, then paste in the share link — anyone who clicks the GIF goes straight to the video."
                actionLabel="Download"
                actionActive={false}
                onAction={downloadGif}
              />
              <ShareCard
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                }
                name="Download video"
                description="Save the full MP4 to your computer — useful for re-uploading to platforms that need a native video file (Instagram, TikTok, YouTube)."
                actionLabel="Download"
                actionActive={false}
                onAction={downloadVideo}
                disabled={!downloadUrl}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-normal text-foreground" title={title}>
          {title}
        </p>
        {tab === 'preview' && onDelete && (
          <button
            onClick={onDelete}
            className="shrink-0 text-muted transition-colors hover:text-red-500"
            title="Delete"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>
    </Modal>
  )
}

function ShareCard({
  icon,
  name,
  description,
  actionLabel,
  actionActive,
  onAction,
  disabled,
}: {
  icon: React.ReactNode
  name: string
  description: string
  actionLabel: string
  actionActive: boolean
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-4 rounded-lg border border-border bg-background px-4 py-3">
      <div className="shrink-0 text-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <button
        onClick={onAction}
        disabled={disabled}
        className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          actionActive
            ? 'border-green-500/50 text-green-600 dark:text-green-400'
            : 'border-border text-muted hover:border-muted hover:text-foreground'
        }`}
      >
        {actionLabel}
      </button>
    </div>
  )
}
