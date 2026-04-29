'use client'

import { useState } from 'react'
import { BOOK_DEMO_URL } from '@/app/config'

type Props = {
  slug: string
  downloadHref: string
  /** When null, the explore button still renders with href="#" — placeholder until upstream wiring lands. */
  interactiveDemoUrl: string | null
}

export default function ShareActions({ slug, downloadHref, interactiveDemoUrl }: Props) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      const url = `${window.location.origin}/v/${slug}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  const baseBtn =
    'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors'
  const secondary = `${baseBtn} border border-border bg-surface text-foreground hover:bg-background`
  // `group` lets the trailing arrow translate on hover of the link itself.
  const primary = `${baseBtn} group bg-orange-500 text-white hover:bg-orange-600`

  const exploreHref = interactiveDemoUrl ?? '#'
  const isExternal = !!interactiveDemoUrl

  return (
    <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      <a href={downloadHref} className={secondary}>
        <DownloadIcon />
        <span>Download Video</span>
      </a>
      <button
        type="button"
        onClick={copyLink}
        className={`${secondary} ${copied ? 'text-green-600 dark:text-green-500' : ''}`}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
        <span>{copied ? 'Copied' : 'Copy Link'}</span>
      </button>
      <a href={BOOK_DEMO_URL} target="_blank" rel="noreferrer" className={secondary}>
        <CalendarIcon />
        <span>Book a Demo</span>
      </a>
      <a
        href={exploreHref}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noreferrer' : undefined}
        className={primary}
      >
        <span>Explore Your Interactive Preview</span>
        <LongArrowIcon />
      </a>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function LongArrowIcon() {
  return (
    <svg
      viewBox="0 0 36 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-7 transition-transform duration-200 group-hover:translate-x-1"
      aria-hidden="true"
    >
      <path d="M2 12h28" />
      <path d="M25 5l7 7-7 7" />
    </svg>
  )
}
