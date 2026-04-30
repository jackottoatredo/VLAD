'use client'

import { useEffect, useRef } from 'react'
import { useVisitorId } from './useVisitorId'

type Props = {
  slug: string
  src: string
  poster: string | undefined
  className?: string
}

type EventType =
  | 'visit_linked'
  | 'video_play'
  | 'video_pause'
  | 'video_quartile'
  | 'video_end'
type EventBody = {
  type: EventType
  slug: string
  payload?: Record<string, unknown>
  originalReferrer?: string
  visitorId?: string
}

// Best-effort beacon — sendBeacon survives tab close, fetch+keepalive is
// the fallback for browsers that don't support beacon for JSON. Errors
// are swallowed: analytics must never affect playback.
function sendEvent(body: EventBody) {
  try {
    const json = JSON.stringify(body)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([json], { type: 'application/json' })
      if (navigator.sendBeacon('/api/engagement/event', blob)) return
    }
    void fetch('/api/engagement/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
      keepalive: true,
    })
  } catch {
    /* swallow */
  }
}

export default function ShareVideoPlayer({ slug, src, poster, className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const visitorId = useVisitorId()

  // Per-mount dedup. A user pause+play within 30s is one play. Each
  // quartile fires at most once. Refs (not state) so updates don't
  // re-render the player.
  const lastPlayMsRef = useRef(0)
  const lastPauseMsRef = useRef(0)
  const quartilesFiredRef = useRef<Set<25 | 50 | 75>>(new Set())
  const endFiredRef = useRef(false)
  const visitLinkedFiredRef = useRef(false)
  const originalReferrerRef = useRef<string>('')
  // Mirror visitorId into a ref so the listeners (closed over the
  // initial render's value) always read the latest resolved ID.
  const visitorIdRef = useRef<string | null>(null)

  useEffect(() => {
    visitorIdRef.current = visitorId
  }, [visitorId])

  useEffect(() => {
    originalReferrerRef.current = document.referrer ?? ''
  }, [])

  // One-shot beacon to anchor this browser's visitor_id to this slug.
  // Fires after the localStorage read resolves; the dashboard uses this
  // event to count unique humans even if they don't engage further.
  useEffect(() => {
    if (!visitorId || visitLinkedFiredRef.current) return
    visitLinkedFiredRef.current = true
    sendEvent({
      type: 'visit_linked',
      slug,
      visitorId,
      originalReferrer: originalReferrerRef.current || undefined,
    })
  }, [visitorId, slug])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const beacon = (type: EventType, payload?: Record<string, unknown>) => {
      sendEvent({
        type,
        slug,
        payload,
        originalReferrer: originalReferrerRef.current || undefined,
        visitorId: visitorIdRef.current ?? undefined,
      })
    }

    const onPlay = () => {
      const now = Date.now()
      if (now - lastPlayMsRef.current < 30_000) return
      lastPlayMsRef.current = now
      beacon('video_play', { currentTime: v.currentTime })
    }

    const onPause = () => {
      // Skip the synthetic pause that fires when the video reaches `ended` —
      // that's already captured by `video_end`. Also skip pauses caused by
      // seeking (the browser may fire pause→seeking→play in quick succession).
      if (v.ended || v.seeking) return
      const now = Date.now()
      if (now - lastPauseMsRef.current < 30_000) return
      lastPauseMsRef.current = now
      beacon('video_pause', { currentTime: v.currentTime })
    }

    const onTimeUpdate = () => {
      const dur = v.duration
      if (!Number.isFinite(dur) || dur <= 0) return
      const pct = (v.currentTime / dur) * 100
      for (const q of [25, 50, 75] as const) {
        if (pct >= q && !quartilesFiredRef.current.has(q)) {
          quartilesFiredRef.current.add(q)
          beacon('video_quartile', { q })
        }
      }
    }

    const onEnded = () => {
      if (endFiredRef.current) return
      endFiredRef.current = true
      beacon('video_end')
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('ended', onEnded)
    }
  }, [slug])

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      controls
      playsInline
      className={className}
    />
  )
}
