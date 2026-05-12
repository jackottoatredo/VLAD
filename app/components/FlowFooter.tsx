'use client'

import type { NavButton } from './PageLayout'

type Props = {
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function FlowFooter({ navBack, navForward }: Props) {
  if (!navBack && !navForward) return null

  return (
    <div className="border-t border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        {navBack ? (
          <button
            type="button"
            onClick={navBack.onClick}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm transition hover:bg-background"
          >
            <span>←</span>
            <span>{navBack.label}</span>
          </button>
        ) : (
          <span />
        )}
        {navForward ? (
          <button
            type="button"
            onClick={navForward.disabled ? undefined : navForward.onClick}
            disabled={navForward.disabled}
            className={`flex items-center gap-2 rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition ${
              navForward.disabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-orange-600'
            }`}
          >
            <span>{navForward.label}</span>
            <span>→</span>
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
