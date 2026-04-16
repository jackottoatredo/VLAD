'use client'

import { useState, useRef, useEffect } from 'react'

type Option = { value: string; label: string }

type Props = {
  options: Option[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  placeholder?: string
}

export default function MultiSelect({ options, selected, onChange, placeholder = 'Select…' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm outline-none focus:border-zinc-500"
      >
        <span className={selected.size === 0 ? 'text-zinc-500' : 'text-zinc-200'}>{label}</span>
        <span className="text-xs text-zinc-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                selected.has(o.value)
                  ? 'border-zinc-400 bg-zinc-400 text-zinc-900'
                  : 'border-zinc-600'
              }`}>
                {selected.has(o.value) && <span className="text-[10px] leading-none">✓</span>}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
