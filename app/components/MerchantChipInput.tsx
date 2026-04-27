'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MerchantSearchRow, ScrapeStatus } from '@/types/merchant'

/**
 * A chip in the merchant picker. Three flavors:
 *  - `merchant`: matched a row in the previews DB. Carries scrape status so the
 *    chip background can reflect completeness.
 *  - `url`: free text the user typed and committed (comma/Enter), looks like a
 *    URL but isn't in the DB yet. Rendered with a blue outline — a future
 *    iteration can offer to scrape these.
 *  - `invalid`: free text that doesn't parse as a URL and isn't in the DB.
 *    Rendered with an orange outline. Not actionable.
 */
export type MerchantChip =
  | { kind: 'merchant'; id: string; brandName: string; websiteUrl: string; status: ScrapeStatus }
  | { kind: 'url'; text: string; validating?: boolean }
  | { kind: 'invalid'; text: string }

type Props = {
  value: MerchantChip[]
  onChange: (next: MerchantChip[]) => void
  placeholder?: string
}

const DEBOUNCE_MS = 200

/** Bare-domain or protocol-prefixed URL detector — accepts `nike.com`, `https://nike.com/foo`. */
function looksLikeUrl(input: string): boolean {
  const text = input.trim().toLowerCase()
  if (!text) return false
  const noProtocol = text.replace(/^https?:\/\//, '')
  const host = noProtocol.split('/')[0]
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)
}

// Palette rule: white fill = usable, colored fill = problem of some kind.
// Borders distinguish "in flight" states without changing the fill.
const MERCHANT_CHIP_CLASS: Record<ScrapeStatus, string> = {
  complete: 'border-gray-300 bg-white text-slate-900',
  incomplete: 'border-orange-500 bg-orange-500 text-white',
  pending: 'border-blue-500 bg-white text-slate-900',
}

const FREE_TEXT_CHIP_CLASS = {
  url: 'border-blue-500 bg-white text-slate-900',
  invalid: 'border-red-500 bg-red-500 text-white',
} as const

function chipClass(chip: MerchantChip): string {
  const base = 'flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs'
  const stateClass =
    chip.kind === 'merchant' ? MERCHANT_CHIP_CLASS[chip.status] : FREE_TEXT_CHIP_CLASS[chip.kind]
  const pulse = chip.kind === 'url' && chip.validating ? ' animate-pulse' : ''
  return `${base} ${stateClass}${pulse}`
}

function chipLabel(chip: MerchantChip): string {
  return chip.kind === 'merchant' ? chip.brandName : chip.text
}

function chipKey(chip: MerchantChip): string {
  return chip.kind === 'merchant' ? `m:${chip.id}` : `t:${chip.text}`
}

const SEARCH_TOOL_BASE = 'https://search-redo-internal-replit.replit.app'

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21" />
    </svg>
  )
}

type StatusDescriptor = {
  url: string
  label: string
  action?: { href: string; icon: React.ReactNode; title: string }
}

function describeStatus(chip: MerchantChip): StatusDescriptor {
  if (chip.kind === 'merchant') {
    if (chip.status === 'complete') return { url: chip.websiteUrl, label: 'Scrape Complete' }
    if (chip.status === 'pending') return { url: chip.websiteUrl, label: 'Scrape Pending' }
    return {
      url: chip.websiteUrl,
      label: 'Scrape Incomplete',
      action: {
        href: `${SEARCH_TOOL_BASE}/previews?q=${encodeURIComponent(chip.websiteUrl)}`,
        icon: <EditIcon />,
        title: 'Edit in scrape tool',
      },
    }
  }
  if (chip.kind === 'url') {
    if (chip.validating) return { url: chip.text, label: 'Checking DNS…' }
    return {
      url: chip.text,
      label: 'Unscraped URL',
      action: {
        href: `${SEARCH_TOOL_BASE}/search`,
        icon: <PlayIcon />,
        title: 'Open scrape tool',
      },
    }
  }
  return { url: chip.text, label: 'Invalid URL' }
}

function ChipTooltip({ chip }: { chip: MerchantChip }) {
  const desc = describeStatus(chip)
  return (
    <div
      className="pointer-events-none absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-1.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100"
      role="tooltip"
    >
      <div className="flex items-center gap-2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-xs text-slate-900 shadow-lg ring-1 ring-black/5">
        <span className="font-mono text-[11px]">{desc.url}</span>
        <span className="text-slate-400">—</span>
        <span>{desc.label}</span>
        {desc.action && (
          <a
            href={desc.action.href}
            target="_blank"
            rel="noreferrer"
            title={desc.action.title}
            onClick={(e) => e.stopPropagation()}
            className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {desc.action.icon}
          </a>
        )}
      </div>
    </div>
  )
}

const STATUS_DOT_CLASS: Record<ScrapeStatus, string> = {
  complete: 'bg-white',
  incomplete: 'bg-orange-500',
  pending: 'bg-blue-500',
}

export default function MerchantChipInput({
  value,
  onChange,
  placeholder = 'Type to search merchants…',
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MerchantSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [open, setOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const reqIdRef = useRef(0)

  // The async DNS check resolves after onChange has potentially fired again, so
  // we need the latest value array (not the closure) when we patch the chip.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const selectedMerchantIds = useMemo(
    () => new Set(value.flatMap((c) => (c.kind === 'merchant' ? [c.id] : []))),
    [value],
  )
  const filtered = useMemo(
    () => results.filter((r) => !selectedMerchantIds.has(r.id)),
    [results, selectedMerchantIds],
  )

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    const id = ++reqIdRef.current
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/previews/search?q=${encodeURIComponent(trimmed)}`)
        const data = (await res.json()) as { results?: MerchantSearchRow[]; error?: string }
        if (id !== reqIdRef.current) return
        setResults(res.ok ? data.results ?? [] : [])
      } catch {
        if (id !== reqIdRef.current) return
        setResults([])
      } finally {
        if (id === reqIdRef.current) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    setActiveIdx(0)
  }, [filtered.length])

  function commitMerchant(row: MerchantSearchRow) {
    if (selectedMerchantIds.has(row.id)) return
    onChange([
      ...value,
      {
        kind: 'merchant',
        id: row.id,
        brandName: row.brandName,
        websiteUrl: row.websiteUrl,
        status: row.status,
      },
    ])
    setQuery('')
    setResults([])
    setActiveIdx(0)
  }

  async function verifyDns(text: string) {
    let resolved = false
    try {
      const res = await fetch(`/api/url-check?url=${encodeURIComponent(text)}`)
      const data = (await res.json()) as { resolved?: boolean }
      resolved = !!data.resolved
    } catch {
      // Network error — treat as resolvable so a transient blip doesn't
      // demote a chip the user actually typed correctly.
      resolved = true
    }
    const current = valueRef.current
    const idx = current.findIndex((c) => c.kind === 'url' && c.text === text)
    if (idx === -1) return // chip was removed mid-flight
    const next = current.slice()
    next[idx] = resolved ? { kind: 'url', text } : { kind: 'invalid', text }
    onChange(next)
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text || !text.includes(',')) return // single entry — let the default paste land in the input
    e.preventDefault()

    const pieces = text
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (pieces.length === 0) return

    // Look up each piece in parallel so a 20-row paste is one network round trip,
    // not twenty serial ones.
    const searches = await Promise.all(
      pieces.map(async (piece) => {
        try {
          const res = await fetch(`/api/previews/search?q=${encodeURIComponent(piece)}`)
          const data = (await res.json()) as { results?: MerchantSearchRow[] }
          return { piece, results: data.results ?? [] }
        } catch {
          return { piece, results: [] as MerchantSearchRow[] }
        }
      }),
    )

    const newChips: MerchantChip[] = []
    const urlChipsToVerify: string[] = []

    for (const { piece, results } of searches) {
      const allSoFar = [...value, ...newChips]
      // Strip protocol + path so "https://nike.com/foo" matches the bare-domain DB row.
      const stripped = piece.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const match = results.find(
        (r) =>
          r.websiteUrl.toLowerCase() === stripped ||
          r.brandName.toLowerCase() === piece.toLowerCase(),
      )

      if (match) {
        if (allSoFar.some((c) => c.kind === 'merchant' && c.id === match.id)) continue
        newChips.push({
          kind: 'merchant',
          id: match.id,
          brandName: match.brandName,
          websiteUrl: match.websiteUrl,
          status: match.status,
        })
        continue
      }

      if (allSoFar.some((c) => c.kind !== 'merchant' && c.text === piece)) continue
      if (looksLikeUrl(piece)) {
        newChips.push({ kind: 'url', text: piece, validating: true })
        urlChipsToVerify.push(piece)
      } else {
        newChips.push({ kind: 'invalid', text: piece })
      }
    }

    if (newChips.length === 0) return

    onChange([...value, ...newChips])
    setQuery('')
    setResults([])
    setActiveIdx(0)

    // verifyDns reads valueRef after its own async fetch, by which point React
    // will have committed the chips we just added.
    for (const text of urlChipsToVerify) {
      void verifyDns(text)
    }
  }

  function commitFreeText(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    // De-dupe against existing free-text chips by exact text match.
    const dup = value.some((c) => c.kind !== 'merchant' && c.text === trimmed)
    if (dup) {
      setQuery('')
      return
    }
    if (looksLikeUrl(trimmed)) {
      onChange([...value, { kind: 'url', text: trimmed, validating: true }])
      void verifyDns(trimmed)
    } else {
      onChange([...value, { kind: 'invalid', text: trimmed }])
    }
    setQuery('')
    setResults([])
    setActiveIdx(0)
  }

  function remove(chip: MerchantChip) {
    onChange(value.filter((c) => chipKey(c) !== chipKey(chip)))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace at empty input pops the last chip.
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
      return
    }

    if (e.key === 'ArrowDown') {
      if (filtered.length > 0) {
        e.preventDefault()
        setOpen(true)
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
      }
      return
    }
    if (e.key === 'ArrowUp') {
      if (filtered.length > 0) {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      }
      return
    }

    if (e.key === 'Escape') {
      setOpen(false)
      return
    }

    // Tab / Enter — accept the active suggestion if one exists; otherwise
    // commit the typed text as a free-text chip (URL/invalid). Tab still
    // falls through to focus navigation when the input is empty.
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (open && filtered.length > 0) {
        e.preventDefault()
        const row = filtered[activeIdx]
        if (row) commitMerchant(row)
        return
      }
      if (query.trim()) {
        e.preventDefault()
        commitFreeText(query)
      }
      return
    }

    // Comma — explicitly REJECTS the suggestion and commits the typed text
    // verbatim as a free-text chip (URL or invalid). Empty input → swallow
    // the keystroke so a stray ',' never lands in the field.
    if (e.key === ',') {
      e.preventDefault()
      if (query.trim()) commitFreeText(query)
    }
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-2 text-sm shadow-inner focus-within:border-gray-400 dark:focus-within:border-gray-500"
      >
        {value.map((chip) => (
          <span key={chipKey(chip)} className="group relative inline-flex">
            <span className={chipClass(chip)}>
              <span>{chipLabel(chip)}</span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(chip)
                }}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${chipLabel(chip)}`}
              >
                ×
              </button>
            </span>
            <ChipTooltip chip={chip} />
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-md">
          {loading && filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">Searching…</p>
          )}
          {filtered.map((r, i) => {
            const active = i === activeIdx
            return (
              <button
                key={r.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commitMerchant(r)
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
                  active
                    ? 'bg-background text-foreground'
                    : 'text-muted hover:bg-background hover:text-foreground'
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full border border-border/50 ${STATUS_DOT_CLASS[r.status]}`}
                  title={r.status}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm">{r.brandName}</span>
                  <span className="truncate text-xs opacity-70">{r.websiteUrl}</span>
                </span>
              </button>
            )
          })}
          {!loading && filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">No matches.</p>
          )}
        </div>
      )}
    </div>
  )
}
