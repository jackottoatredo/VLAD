'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SHARE_BASE_URL } from '@/app/config'
import Modal from './Modal'

type JobRequestInfo = { endpoint: string; body: unknown }

type Props = {
  title: string
  videoUrl?: string | null
  downloadName?: string
  /** Clip playback to this range (seconds). When end is 0 or undefined, no upper bound. */
  trimStartSec?: number
  trimEndSec?: number
  /** When present, enables the share-link / GIF actions on the Share tab. */
  slug?: string | null
  /** Original render job payload — surfaced via the info popover so the rep can see what settings produced this output. */
  jobRequest?: JobRequestInfo | null
  onClose: () => void
  onDelete?: () => void
  /** Opens the rendering flow pre-populated with this render's settings so the user can re-render after changes. */
  onEdit?: () => void
}

type Tab = 'preview' | 'share'
type CopyId = 'share' | 'video' | 'gif' | 'gif-embed' | 'thumb' | 'thumb-embed'

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type SettingsRow = { label: string; value: string }

// Endpoint values come from the merge-export page; anything else is unknown
// historical data, so fall back to the raw string.
function endpointLabel(endpoint: string): string {
  if (endpoint === '/api/merge-export') return 'Merge export'
  if (endpoint === '/api/product-only-export') return 'Product-only export'
  return endpoint
}

// Defensive — body shape varies by endpoint and may be from an older schema.
// Read each field with `in` checks and only push rows we recognize.
function describeJobBody(body: unknown): SettingsRow[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const rows: SettingsRow[] = []

  const describeSection = (
    label: string,
    section: unknown,
  ) => {
    if (!section || typeof section !== 'object') return
    const s = section as Record<string, unknown>
    const mode = s.modeSource === 'custom' && typeof s.customMode === 'string' && s.customMode
      ? `custom: ${s.customMode}`
      : (typeof s.modeSource === 'string' ? s.modeSource : null)
    const pos = s.positionSource === 'custom' && typeof s.customPosition === 'string' && s.customPosition
      ? `custom: ${s.customPosition}`
      : (typeof s.positionSource === 'string' ? s.positionSource : null)
    if (mode) rows.push({ label: `${label} mode`, value: mode })
    if (pos) rows.push({ label: `${label} position`, value: pos })
  }

  if (b.introEnabled !== false) describeSection('Intro', b.introSettings)
  if (b.productEnabled !== false) describeSection('Product', b.productSettings)

  const tr = b.transition
  if (tr && typeof tr === 'object') {
    const t = tr as Record<string, unknown>
    const fmtTransition = (kind: unknown, dur: unknown): string | null => {
      if (typeof kind !== 'string') return null
      if (kind === 'none') return 'none'
      return typeof dur === 'number' ? `${kind} (${Math.round(dur)}ms)` : kind
    }
    const audio = fmtTransition(t.audio, t.audioDurationMs)
    const video = fmtTransition(t.video, t.videoDurationMs)
    const overlay = fmtTransition(t.overlay, t.overlayDurationMs)
    const mouse = fmtTransition(t.mouse, t.mouseDurationMs)
    if (audio) rows.push({ label: 'Audio transition', value: audio })
    if (video) rows.push({ label: 'Video transition', value: video })
    if (overlay) rows.push({ label: 'Overlay transition', value: overlay })
    if (mouse) rows.push({ label: 'Mouse transition', value: mouse })
  }

  const brand = b.merchantBrand
  if (brand && typeof brand === 'object') {
    const m = brand as Record<string, unknown>
    if (typeof m.brandName === 'string' && m.brandName) rows.push({ label: 'Brand', value: m.brandName })
    if (typeof m.websiteUrl === 'string' && m.websiteUrl) rows.push({ label: 'Website', value: m.websiteUrl })
  }

  return rows
}

export default function RenderPreviewModal({
  title,
  videoUrl,
  downloadName,
  trimStartSec,
  trimEndSec,
  slug,
  jobRequest,
  onClose,
  onDelete,
  onEdit,
}: Props) {
  const [tab, setTab] = useState<Tab>('preview')
  const [showInfo, setShowInfo] = useState(false)
  const infoRef = useRef<HTMLDivElement | null>(null)
  // Tracks which Copy URL just fired so the corresponding card flashes
  // 'Copied ✓' for 2s. Downloads and Open Link don't flash — the browser /
  // new tab is the confirmation.
  const [copiedId, setCopiedId] = useState<CopyId | null>(null)
  // The owner's book_button_mode + cached meeting name — drives the
  // booking-link status footer under the Share page card. Loaded once on
  // mount; null until the fetch resolves (or when there's no slug since
  // the share tab is disabled in that case).
  const [bookingMode, setBookingMode] = useState<'website_form' | 'hidden' | 'hubspot' | null>(null)
  const [bookingMeetingName, setBookingMeetingName] = useState<string | null>(null)
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

  // Dismiss the info popover on outside click or Escape. The listener is
  // only attached while open so the modal's other interactions aren't
  // affected. mousedown (not click) so the popover closes before the
  // underlying button receives focus.
  useEffect(() => {
    if (!showInfo) return
    function onDocMouseDown(e: MouseEvent) {
      if (!infoRef.current) return
      if (!infoRef.current.contains(e.target as Node)) setShowInfo(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowInfo(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showInfo])

  // Resolve the owner's booking-link mode once. Modal is only opened by
  // logged-in users (the rep), so the GET reflects their own setting.
  // Errors are swallowed — failure to fetch hides the warning, which is a
  // safe default. Skip when sharing is disabled (no slug).
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    void fetch('/api/users/me/hubspot-meeting', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { mode?: 'website_form' | 'hidden' | 'hubspot'; meetingName?: string | null } | null) => {
        if (cancelled || !body?.mode) return
        setBookingMode(body.mode)
        setBookingMeetingName(body.meetingName ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug])

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

  // Public URLs for the four shareables. Computed lazily inside handlers so
  // window.location.origin is only read in the browser.
  const sharePagePath = slug ? `/video-demos/${slug}` : null
  const videoAssetPath = slug ? `/video-demos/${slug}/video.mp4` : null
  const gifAssetPath = slug ? `/video-demos/${slug}/preview.gif` : null
  const thumbnailAssetPath = slug ? `/video-demos/${slug}/poster.jpg` : null

  function flashCopy(id: CopyId) {
    setCopiedId(id)
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000)
  }

  async function copyAbsolute(path: string | null, id: CopyId) {
    if (!path) return
    try {
      const base = SHARE_BASE_URL ?? window.location.origin
      await navigator.clipboard.writeText(`${base}${path}`)
      flashCopy(id)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }

  function openSharePage() {
    if (!sharePagePath) return
    const base = SHARE_BASE_URL ?? window.location.origin
    window.open(`${base}${sharePagePath}`, '_blank', 'noopener,noreferrer')
  }

  // The Clipboard API doesn't accept image/gif or video/mp4 (deliberate
  // spec restriction in Chromium and Safari), so we only ever offer
  // downloads for binary assets. Same-origin <a download> hits our
  // /video-demos/ route, which forces Content-Disposition: attachment via a
  // presigned R2 URL.
  function triggerDownload(href: string) {
    const a = document.createElement('a')
    a.href = href
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function downloadVideo() {
    // Prefer the public /video-demos/{slug}/download route (sets attachment
    // headers) when a slug exists; otherwise fall back to the auth'd stream
    // URL the modal already has.
    if (slug) triggerDownload(`/video-demos/${slug}/download`)
    else if (downloadUrl) triggerDownload(downloadUrl)
  }

  function downloadGif() {
    if (!slug) return
    triggerDownload(`/video-demos/${slug}/download-gif`)
  }

  function downloadThumbnail() {
    if (!slug) return
    triggerDownload(`/video-demos/${slug}/download-poster`)
  }

  // Writes an HTML snippet — <a href="share-page"><img src="asset"></a> — to
  // the clipboard. When pasted into Gmail / Outlook web / Apple Mail / Slack
  // / Notion, the composer parses the HTML, fetches the image, and inlines
  // it with the share link already wrapped — no manual right-click step.
  //
  // We write both text/html AND text/plain. Many composers prefer the
  // text/plain payload when present (or when they can't parse the HTML),
  // and a sole text/html clipboard item leaves naive paste targets with
  // nothing visible. The plain-text fallback is just the share URL so the
  // recipient at least gets a link.
  async function copyEmbed(assetPath: string | null, id: CopyId) {
    if (!slug || !sharePagePath || !assetPath) return
    try {
      const origin = SHARE_BASE_URL ?? window.location.origin
      const linkUrl = `${origin}${sharePagePath}`
      const imgUrl = `${origin}${assetPath}`
      // Wrap the anchor in a <p>, then follow it with an empty <p><br></p>.
      // The block-level paragraph keeps the cursor from landing inside the
      // anchor on paste, and the trailing empty paragraph gives Gmail an
      // explicitly unstyled block to land in — otherwise it inherits the
      // link styling from the previous element when the user starts typing.
      const html =
        `<p><a href="${linkUrl}">` +
          `<img src="${imgUrl}" alt="View video" style="display:block;border:0;max-width:100%;height:auto" />` +
        `</a></p>` +
        `<p><br></p>`
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([linkUrl], { type: 'text/plain' }),
        }),
      ])
      flashCopy(id)
    } catch (err) {
      console.error('Failed to copy embed:', err)
    }
  }

  const settingsRows = describeJobBody(jobRequest?.body)
  const endpointName = jobRequest ? endpointLabel(jobRequest.endpoint) : null
  const trimRow = hasTrim
    ? `${formatTime(clipStart)} – ${clipEndRaw > 0 ? formatTime(clipEndRaw) : 'end'}`
    : null
  const hasAnySettings = !!endpointName || !!trimRow || !!slug || settingsRows.length > 0

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
          {t === 'preview' ? 'Review' : 'Share'}
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
            <div className="grid h-full grid-cols-2 grid-rows-2 gap-2">
              <ShareCard
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                }
                name="Share page"
                description="View video on the web with engagement statistics collected. OpenGraph metadata support rich preview in WhatsApp, iMessage, LinkedIn, Slack and more"
                actions={[
                  { label: 'Open link', onAction: openSharePage },
                  { label: copiedId === 'share' ? 'Copied ✓' : 'Copy URL', active: copiedId === 'share', onAction: () => copyAbsolute(sharePagePath, 'share') },
                ]}
                footer={
                  <BookingLinkStatus
                    mode={bookingMode}
                    meetingName={bookingMeetingName}
                    onNavigate={onClose}
                  />
                }
              />
              <ShareCard
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                }
                name="Video"
                description="MP4 for direct sharing or upload. No engagement tracking."
                actions={[
                  { label: 'Download', onAction: downloadVideo, disabled: !slug && !downloadUrl },
                  { label: copiedId === 'video' ? 'Copied ✓' : 'Copy URL', active: copiedId === 'video', onAction: () => copyAbsolute(videoAssetPath, 'video') },
                ]}
              />
              <ShareCard
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
                }
                name="GIF"
                description="Animated Preview - Best option for sharing in gmail. Copy Embed pastes the GIF with the share link already attached."
                actions={[
                  { label: 'Download', onAction: downloadGif },
                  { label: copiedId === 'gif' ? 'Copied ✓' : 'Copy URL', active: copiedId === 'gif', onAction: () => copyAbsolute(gifAssetPath, 'gif') },
                  { label: copiedId === 'gif-embed' ? 'Copied ✓' : 'Copy Embed', active: copiedId === 'gif-embed', onAction: () => copyEmbed(gifAssetPath, 'gif-embed') },
                ]}
              />
              <ShareCard
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                }
                name="Thumbnail"
                description="Static Cover Image - GIF alternative. Copy Embed pastes the thumbnail with the share link already attached."
                actions={[
                  { label: 'Download', onAction: downloadThumbnail },
                  { label: copiedId === 'thumb' ? 'Copied ✓' : 'Copy URL', active: copiedId === 'thumb', onAction: () => copyAbsolute(thumbnailAssetPath, 'thumb') },
                  { label: copiedId === 'thumb-embed' ? 'Copied ✓' : 'Copy Embed', active: copiedId === 'thumb-embed', onAction: () => copyEmbed(thumbnailAssetPath, 'thumb-embed') },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-normal text-foreground" title={title}>
          {title}
        </p>
        <div className="relative flex shrink-0 items-center" ref={infoRef}>
          <button
            type="button"
            onClick={() => setShowInfo((s) => !s)}
            className={`flex items-center transition-colors ${showInfo ? 'text-foreground' : 'text-muted hover:text-foreground'}`}
            aria-label="Video settings"
            aria-expanded={showInfo}
            title="Video settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          {showInfo && (
            <div className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-lg border border-border bg-surface p-3 text-left shadow-lg">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">Video settings</p>
              {hasAnySettings ? (
                <dl className="mt-2 space-y-1.5 text-xs">
                  {endpointName && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted">Type</dt>
                      <dd className="min-w-0 truncate text-foreground" title={endpointName}>{endpointName}</dd>
                    </div>
                  )}
                  {trimRow && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted">Trim</dt>
                      <dd className="tabular-nums text-foreground">{trimRow}</dd>
                    </div>
                  )}
                  {slug && (
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted">Slug</dt>
                      <dd className="min-w-0 truncate text-foreground" title={slug}>{slug}</dd>
                    </div>
                  )}
                  {settingsRows.map((r) => (
                    <div key={r.label} className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted">{r.label}</dt>
                      <dd className="min-w-0 truncate text-foreground" title={r.value}>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-muted">No settings recorded for this render.</p>
              )}
            </div>
          )}
        </div>
        {tab === 'preview' && onEdit && (
          <button
            onClick={onEdit}
            className="flex shrink-0 items-center text-muted transition-colors hover:text-foreground"
            title="Edit settings & re-render"
            aria-label="Edit settings & re-render"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        )}
        {tab === 'preview' && onDelete && (
          <button
            onClick={onDelete}
            className="flex shrink-0 items-center text-muted transition-colors hover:text-red-500"
            title="Delete"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>
    </Modal>
  )
}

type CardAction = {
  label: string
  active?: boolean
  disabled?: boolean
  onAction: () => void
}

function ShareCard({
  icon,
  name,
  description,
  actions,
  footer,
}: {
  icon: React.ReactNode
  name: string
  description: string
  actions: CardAction[]
  /** Rendered below the action buttons. Used by the Share-page card to surface the booking-link warning. */
  footer?: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col items-center rounded-lg border border-border bg-background px-[10%] pb-[10%] pt-[5%] text-center">
      <div className="flex flex-col items-center gap-1">
        <div className="text-foreground">{icon}</div>
        <p className="max-w-full truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="line-clamp-3 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-center gap-2 pt-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onAction}
            disabled={a.disabled}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              a.active
                ? 'border-green-500/50 text-green-600 dark:text-green-400'
                : 'border-border text-muted hover:border-muted hover:text-foreground'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {footer}
    </div>
  )
}

// Status line for the rep's booking-link configuration. Always renders;
// amber when no rep-specific link is configured (default website form or
// hidden), muted when a HubSpot link is set. The whole row is a Next Link
// to /tools/settings — clicking closes the modal first via onNavigate.
function BookingLinkStatus({
  mode,
  meetingName,
  onNavigate,
}: {
  mode: 'website_form' | 'hidden' | 'hubspot' | null
  meetingName: string | null
  onNavigate: () => void
}) {
  // Pre-resolve label state so the row never collapses while the GET is
  // in flight — pessimistic copy keeps the warning color until proven
  // otherwise. (Nothing is shown to viewers; this is rep-only UI.)
  const label =
    mode === 'hubspot'
      ? meetingName ?? 'HubSpot meeting link'
      : mode === 'hidden'
        ? 'Hidden'
        : 'Generic website form'
  const isWarning = mode !== 'hubspot'
  const colorCls = isWarning
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-muted'
  return (
    <Link
      href="/tools/settings"
      onClick={onNavigate}
      className={`mt-2 flex w-full items-center justify-center gap-1 text-[0.7rem] leading-tight hover:underline ${colorCls}`}
      title="Edit booking link in Settings"
    >
      <span className="shrink-0">Booking link:</span>
      <span className="min-w-0 truncate">{label}</span>
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </Link>
  )
}
