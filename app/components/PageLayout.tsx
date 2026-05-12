'use client'

import React, { useEffect, useState } from 'react'

export type NavButton = {
  label: string
  onClick: () => void
  disabled?: boolean
}

type Props = {
  instructions: React.ReactNode
  settings: React.ReactNode
  children: React.ReactNode
}

export default function PageLayout({ instructions, settings, children }: Props) {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const measure = () => setNarrow(window.innerWidth <= window.innerHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  if (narrow) {
    return (
      <div className="h-full w-full bg-background font-sans">
        <div className="mx-auto flex h-full max-w-[1000px] flex-col gap-[10px]">
          <div className="relative flex aspect-video w-full shrink-0 flex-col">
            {children}
          </div>
          {settings && (
            <div className="flex shrink-0 flex-col gap-[10px] rounded-2xl border border-border bg-surface p-4 shadow-md">
              {settings}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
            <p className="shrink-0 flex min-h-11 items-center border-b border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted">
              Instructions
            </p>
            <div className="flex-1 overflow-y-auto p-4 text-sm text-muted">{instructions}</div>
          </div>
        </div>
      </div>
    )
  }

  // Wide layout: 250px left column (instructions + controls) + media filling the
  // remaining area, sized as large as possible at its aspect ratio and centered.
  return (
    <div className="h-full w-full bg-background font-sans">
      <div className="flex h-full gap-[10px]">
        <div className="flex w-[315px] shrink-0 flex-col gap-[10px]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
            <p className="shrink-0 flex min-h-11 items-center border-b border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted">
              Instructions
            </p>
            <div className="flex-1 overflow-y-auto p-4 text-sm text-muted">{instructions}</div>
          </div>
          {settings && (
            <div className="flex shrink-0 flex-col gap-[10px] rounded-2xl border border-border bg-surface p-4 shadow-md">
              {settings}
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </div>
  )
}
