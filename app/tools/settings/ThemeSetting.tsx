'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export default function ThemeSetting() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const current = mounted ? (theme === 'system' ? resolvedTheme : theme) : undefined

  return (
    <div className="inline-flex rounded-md border border-border bg-background p-1">
      {OPTIONS.map((opt) => {
        const active = current === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            aria-pressed={active}
            className={
              'rounded px-3 py-1.5 text-sm transition-colors ' +
              (active
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted hover:text-foreground')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
