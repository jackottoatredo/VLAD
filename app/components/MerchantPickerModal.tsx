'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import ScrapePromptModal from './ScrapePromptModal'

export type PickedMerchant = {
  id: string
  brandName: string
  websiteUrl: string
}

type PreviewStatus = 'pending' | 'complete' | 'incomplete'

type SearchRow = {
  id: string
  brandName: string
  websiteUrl: string
  activityAt: string
  wasEdited: boolean
  status: PreviewStatus
}

const STATUS_STYLES: Record<PreviewStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-blue-500 text-white' },
  complete: { label: 'Complete', className: 'bg-white text-slate-900' },
  incomplete: { label: 'Incomplete', className: 'bg-orange-500 text-white' },
}

type Props = {
  onSelect: (merchant: PickedMerchant) => void
  onClose: () => void
}

const DEBOUNCE_MS = 200
const EDIT_BASE_URL = 'https://search-redo-internal-replit.replit.app/previews'

function formatActivity(iso: string, wasEdited: boolean): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const prefix = wasEdited ? 'edited' : 'created'
  const diffMs = Math.max(0, Date.now() - then)
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return `${prefix}: just now`
  if (mins < 60) return `${prefix}: ${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${prefix}: ${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hrs / 24)
  return `${prefix}: ${days} ${days === 1 ? 'day' : 'days'} ago`
}

export default function MerchantPickerModal({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScrapePrompt, setShowScrapePrompt] = useState(false)
  const reqIdRef = useRef(0)

  useEffect(() => {
    const id = ++reqIdRef.current
    const handle = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const url = query.trim()
          ? `/api/previews/search?q=${encodeURIComponent(query.trim())}`
          : '/api/previews/search'
        const res = await fetch(url)
        const data = await res.json() as { results?: SearchRow[]; error?: string }
        if (id !== reqIdRef.current) return
        if (!res.ok) {
          setError(data.error ?? 'Search failed.')
          setRows([])
        } else {
          setRows(data.results ?? [])
        }
      } catch {
        if (id !== reqIdRef.current) return
        setError('Search failed.')
        setRows([])
      } finally {
        if (id === reqIdRef.current) setLoading(false)
      }
    }, query ? DEBOUNCE_MS : 0)
    return () => clearTimeout(handle)
  }, [query])

  if (showScrapePrompt) {
    return <ScrapePromptModal onClose={() => setShowScrapePrompt(false)} />
  }

  const emptyCopy = query.trim()
    ? "No match. Click + to trigger a scrape."
    : "No scrapes in the last hour. Search by URL to find a brand."

  return (
    <Modal title="Select merchant" onClose={onClose} size="lg">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by URL (e.g. nike.com)"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted shadow-sm outline-none focus:border-muted"
          />
          <button
            onClick={() => setShowScrapePrompt(true)}
            className="flex items-center justify-center rounded-md border border-border bg-surface px-2.5 text-muted shadow-sm hover:bg-background"
            title="Brand not found? Trigger a scrape"
          >
            +
          </button>
        </div>

        <div className="h-80 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="cursor-pointer border-t border-border hover:bg-background"
                >
                  <td className="px-3 py-2 text-foreground">{r.brandName}</td>
                  <td className="px-3 py-2 text-muted">{r.websiteUrl}</td>
                  <td className="px-3 py-2 text-muted">{formatActivity(r.activityAt, r.wasEdited)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status].className}`}>
                      {STATUS_STYLES[r.status].label}
                    </span>
                  </td>
                  <td className="w-8 px-2 py-2 text-right">
                    <a
                      href={`${EDIT_BASE_URL}?q=${encodeURIComponent(r.websiteUrl)}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-foreground"
                      title="Edit in scrape tool"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </a>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    {error ?? emptyCopy}
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    Searching…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}
