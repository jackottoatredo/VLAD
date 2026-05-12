'use client'

import { useState } from 'react'
import { APP_BASE_URL, SHARE_BASE_URL } from '@/app/config'
import { useVisitorId } from './useVisitorId'
import {
  ArrowRightLongIcon,
  CalendarIcon,
  CheckIcon,
  DownloadIcon,
  LinkIcon,
} from '@/app/components/icons'

type Props = {
  slug: string
  downloadHref: string
  /** When null, the explore button still renders with href="#" — placeholder until upstream wiring lands. */
  interactiveDemoUrl: string | null
  /** False when the rep set book_button_mode='hidden' in /tools/settings — the Book a meeting button is omitted entirely. */
  showBookButton: boolean
}

// Fire-and-forget beacon for client-side click events. Errors swallowed —
// analytics must never break a click.
function beaconClick(type: 'click_copy_link', slug: string, visitorId: string | null) {
  try {
    const body = JSON.stringify({
      type,
      slug,
      originalReferrer: document.referrer || undefined,
      visitorId: visitorId ?? undefined,
    })
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon('/api/engagement/event', blob)) return
    }
    void fetch('/api/engagement/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    })
  } catch {
    /* swallow */
  }
}

export default function ShareActions({ slug, downloadHref, interactiveDemoUrl, showBookButton }: Props) {
  const [copied, setCopied] = useState(false)
  const visitorId = useVisitorId()

  async function copyLink() {
    try {
      const url = `${SHARE_BASE_URL ?? window.location.origin}/video-demos/${slug}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      beaconClick('click_copy_link', slug, visitorId)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  const baseBtn =
    'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors'
  const secondary = `${baseBtn} border border-border bg-surface text-foreground hover:bg-background`
  // `group` lets the trailing arrow translate on hover of the link itself.
  const primary = `${baseBtn} group bg-accent text-white hover:opacity-90`

  // Both outbound CTAs route through /video-demos/[slug]/go so clicks log
  // server-side regardless of client JS. interactiveDemoUrl is null
  // when the share row has no brand_url; in that case we fall back to
  // a placeholder href so the button still renders. Append visitor_id
  // when localStorage has resolved so the redirect endpoint can attach
  // it to the click event.
  //
  // Hrefs are absolute against APP_BASE_URL (not the share origin): in prod
  // the share page lives on redo.com, but redo.com only forwards the page
  // itself — /go must hit the app origin directly or the redirect 404s.
  const visitorParam = visitorId ? `&v=${encodeURIComponent(visitorId)}` : ''
  const bookDemoHref = `${APP_BASE_URL}/video-demos/${slug}/go?to=book-demo${visitorParam}`
  const interactiveDemoHref = interactiveDemoUrl
    ? `${APP_BASE_URL}/video-demos/${slug}/go?to=interactive-demo${visitorParam}`
    : '#'
  const interactiveEnabled = !!interactiveDemoUrl

  return (
    <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      <a href={downloadHref} className={secondary}>
        <DownloadIcon width={18} height={18} />
        <span>Download Video</span>
      </a>
      <button
        type="button"
        onClick={copyLink}
        className={`${secondary} ${copied ? 'text-green-600 dark:text-green-500' : ''}`}
      >
        {copied ? <CheckIcon width={18} height={18} /> : <LinkIcon width={18} height={18} />}
        <span>{copied ? 'Copied' : 'Copy Link'}</span>
      </button>
      {showBookButton && (
        <a href={bookDemoHref} target="_blank" rel="noreferrer" className={secondary}>
          <CalendarIcon width={18} height={18} />
          <span>Book a meeting</span>
        </a>
      )}
      <a
        href={interactiveDemoHref}
        target={interactiveEnabled ? '_blank' : undefined}
        rel={interactiveEnabled ? 'noreferrer' : undefined}
        className={primary}
      >
        <span>Explore Your Interactive Preview</span>
        <ArrowRightLongIcon className="h-4 w-7 transition-transform duration-200 group-hover:translate-x-1" />
      </a>
    </div>
  )
}
