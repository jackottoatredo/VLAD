'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Option = { value: string; label: string; disabled?: boolean }

type Props = {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  size?: 'sm' | 'md'
  /** Extra classes for the outer wrapper — useful for `flex-1` in a row. */
  className?: string
  disabled?: boolean
}

const BUTTON_SIZE: Record<'sm' | 'md', string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
}

const ITEM_TEXT: Record<'sm' | 'md', string> = {
  sm: 'text-xs',
  md: 'text-sm',
}

export default function Select({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  size = 'md',
  className,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click — both refs since the menu is portaled out of the wrapper.
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

  // While open, track the trigger's screen position so the portaled menu can follow scrolls/resizes.
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
    if (disabled) return
    if (!open) {
      const el = triggerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
      }
    }
    setOpen((p) => !p)
  }

  function select(v: string) {
    onChange(v)
    setOpen(false)
  }

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? placeholder

  return (
    <div ref={triggerRef} className={`relative${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className={`flex w-full items-center justify-between rounded-lg border border-border bg-background text-left outline-none focus:border-muted disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_SIZE[size]}`}
      >
        <span className={selected ? 'text-foreground' : 'text-muted'}>{label}</span>
        <span className="text-xs text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && !disabled && pos &&
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
            {options.map((o) => {
              const active = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => select(o.value)}
                  className={`flex w-full items-center px-3 py-1.5 text-left ${ITEM_TEXT[size]} transition-colors ${
                    o.disabled
                      ? 'cursor-not-allowed text-muted opacity-50'
                      : active
                        ? 'bg-accent-soft text-foreground'
                        : 'text-muted hover:bg-background hover:text-foreground'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
