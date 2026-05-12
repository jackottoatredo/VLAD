'use client'

import { SettingsIcon } from '@/app/components/icons'

// Active state (filters applied) gets a small accent dot so the icon
// signals "filters in effect" without needing the modal open.
export function AdminSettingsButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Dashboard filters"
      onClick={onClick}
      className="fixed top-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <SettingsIcon className="h-4 w-4" />
      {active && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
    </button>
  )
}
