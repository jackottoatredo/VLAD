'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminUser } from '@/app/api/admin/users/route'

type Props = {
  /** Selected emails */
  value: string[]
  onChange: (next: string[]) => void
  /** All users available to pick from */
  options: AdminUser[]
  placeholder?: string
}

function userLabel(u: AdminUser): string {
  const name = `${u.firstName} ${u.lastName}`.trim()
  return name || u.email
}

export default function UserChipInput({
  value,
  onChange,
  options,
  placeholder = 'Type to search users…',
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [open, setOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const byEmail = useMemo(() => new Map(options.map((u) => [u.email, u])), [options])
  const selected = useMemo(() => new Set(value), [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options
      .filter((u) => !selected.has(u.email))
      .filter((u) => {
        if (!q) return true
        return (
          u.email.toLowerCase().includes(q) ||
          u.firstName.toLowerCase().includes(q) ||
          u.lastName.toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
  }, [options, selected, query])

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
    setActiveIdx(0)
  }, [filtered.length])

  function commit(email: string) {
    if (selected.has(email)) return
    onChange([...value, email])
    setQuery('')
    setActiveIdx(0)
  }

  function remove(email: string) {
    onChange(value.filter((v) => v !== email))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && filtered.length > 0) {
        e.preventDefault()
        const u = filtered[activeIdx]
        if (u) commit(u.email)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-inner focus-within:border-muted"
      >
        {value.map((email) => {
          const u = byEmail.get(email)
          const label = u ? userLabel(u) : email
          return (
            <span
              key={email}
              className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-foreground"
            >
              <span>{label}</span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(email)
                }}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${label}`}
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

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-md">
          {filtered.map((u, i) => {
            const active = i === activeIdx
            return (
              <button
                key={u.email}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(u.email)
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
                  active
                    ? 'bg-background text-foreground'
                    : 'text-muted hover:bg-background hover:text-foreground'
                }`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm">{userLabel(u)}</span>
                  {userLabel(u) !== u.email && (
                    <span className="truncate text-xs opacity-70">{u.email}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
