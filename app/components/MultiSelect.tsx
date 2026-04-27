'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Option = { value: string; label: string }

type Props = {
  options: Option[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  placeholder?: string
}

export default function MultiSelect({ options, selected, onChange, placeholder = 'Select…' }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!open) return
    function update() {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  function toggleOpen() {
    if (!open) {
      const el = triggerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
      }
    }
    setOpen((p) => !p)
  }

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  let label: string
  if (selected.size === 0) {
    label = placeholder
  } else if (selected.size === 1) {
    const match = options.find((o) => selected.has(o.value))
    label = match?.label ?? '1 selected'
  } else {
    label = `${selected.size} selected`
  }

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm outline-none focus:border-muted"
      >
        <span className={selected.size === 0 ? 'text-muted' : 'text-foreground'}>{label}</span>
        <span className="text-xs text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className="z-[60] max-h-48 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-md"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                  selected.has(o.value)
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border'
                }`}>
                  {selected.has(o.value) && <span className="text-[10px] leading-none">✓</span>}
                </span>
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
