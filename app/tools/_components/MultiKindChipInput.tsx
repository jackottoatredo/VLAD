'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
// Note: activeIdx is clamped against suggestions.length at read time so
// we don't need a setState-in-effect to reset it when filtering.
import {
  hasChip,
  removeChip,
  KIND_COLORS,
  KIND_LABELS,
  type FilterChip,
  type FilterChipKind,
  type FilterOption,
  type FilterOptions,
} from './filters'

type Props = {
  value: FilterChip[]
  onChange: (next: FilterChip[]) => void
  options: FilterOptions
  // Which kinds the input will offer in suggestions. Usage only allows
  // presenter/product/merchant; engagement also allows region.
  enabledKinds: FilterChipKind[]
  placeholder?: string
}

type Suggestion = {
  kind: FilterChipKind
  option: FilterOption
}

export function MultiKindChipInput({
  value,
  onChange,
  options,
  enabledKinds,
  placeholder = 'Type to search…',
}: Props) {
  const [query, setQuery] = useState('')
  const [rawActiveIdx, setRawActiveIdx] = useState(0)
  const [open, setOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Flat suggestions list filtered by query + already-selected. Cap at
  // a sensible number per kind so a long product catalog can't push
  // presenters off the end of the list.
  const PER_KIND_LIMIT = 4
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase()
    const out: Suggestion[] = []
    for (const kind of enabledKinds) {
      const list = optionsByKind(options, kind)
      const matches = list
        .filter(
          (o) =>
            !hasChip(value, { kind, value: o.value, label: o.label }) &&
            (q === '' ||
              o.label.toLowerCase().includes(q) ||
              o.value.toLowerCase().includes(q)),
        )
        .slice(0, PER_KIND_LIMIT)
        .map((option) => ({ kind, option }))
      out.push(...matches)
    }
    return out
  }, [enabledKinds, options, query, value])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Clamp the active index to valid range. The raw state can drift past
  // suggestions.length when the user types and filters narrow; clamping
  // at read time keeps highlight always valid without a setState effect.
  const activeIdx =
    suggestions.length === 0 ? 0 : Math.min(rawActiveIdx, suggestions.length - 1)
  function setActiveIdx(next: number) {
    setRawActiveIdx(next)
  }

  function commit(s: Suggestion) {
    const chip: FilterChip = {
      kind: s.kind,
      value: s.option.value,
      label: s.option.label,
    }
    if (hasChip(value, chip)) return
    onChange([...value, chip])
    setQuery('')
    setActiveIdx(0)
  }

  function remove(chip: FilterChip) {
    onChange(removeChip(value, chip))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
      return
    }
    if (e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault()
        setOpen(true)
        setActiveIdx(Math.min(suggestions.length - 1, activeIdx + 1))
      }
      return
    }
    if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        e.preventDefault()
        setActiveIdx(Math.max(0, activeIdx - 1))
      }
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && suggestions.length > 0) {
        e.preventDefault()
        const s = suggestions[activeIdx]
        if (s) commit(s)
      }
    }
  }

  // Group suggestions for display: contiguous runs of the same kind get
  // a kind heading. Iteration is already kind-grouped above (we loop
  // enabledKinds in order), so we just detect transitions on the fly.
  function renderSuggestions() {
    const items: React.ReactNode[] = []
    let lastKind: FilterChipKind | null = null
    suggestions.forEach((s, i) => {
      if (s.kind !== lastKind) {
        const colors = KIND_COLORS[s.kind]
        items.push(
          <div
            key={`heading-${s.kind}`}
            className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: colors.fg }}
          >
            {KIND_LABELS[s.kind]}
          </div>,
        )
        lastKind = s.kind
      }
      const active = i === activeIdx
      items.push(
        <button
          key={`${s.kind}|${s.option.value}`}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            commit(s)
          }}
          onMouseEnter={() => setActiveIdx(i)}
          className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
            active
              ? 'bg-background text-foreground'
              : 'text-muted hover:bg-background hover:text-foreground'
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm">{s.option.label}</span>
            {s.option.label !== s.option.value && (
              <span className="truncate text-xs opacity-70">{s.option.value}</span>
            )}
          </span>
        </button>,
      )
    })
    return items
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-inner focus-within:border-muted"
      >
        {value.map((chip) => {
          const colors = KIND_COLORS[chip.kind]
          return (
            <span
              key={`${chip.kind}|${chip.value}`}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
              style={{ backgroundColor: colors.bg, color: colors.fg }}
            >
              <span>
                {chip.kind}:{chip.label}
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(chip)
                }}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${chip.label}`}
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
        />
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-md">
          {renderSuggestions()}
        </div>
      )}
    </div>
  )
}

function optionsByKind(opts: FilterOptions, kind: FilterChipKind): FilterOption[] {
  switch (kind) {
    case 'presenter':
      return opts.presenters
    case 'product':
      return opts.products
    case 'merchant':
      return opts.merchants
    case 'region':
      return opts.regions
  }
}
