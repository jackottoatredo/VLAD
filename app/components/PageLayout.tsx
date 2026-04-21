'use client'

import React, { useRef, useState, useEffect } from 'react'

export type NavButton = {
  label: string
  onClick: () => void
  disabled?: boolean
}

type Props = {
  instructions: React.ReactNode
  settings: React.ReactNode
  children: React.ReactNode
  navBack?: NavButton | null
  navForward?: NavButton | null
}

export default function PageLayout({ instructions, settings, children, navBack, navForward }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return
      const top = containerRef.current.getBoundingClientRect().top
      setOffset(-top / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <div ref={containerRef} className="h-full w-full bg-background font-sans" style={{ padding: '0 150px' }}>
      {/* Back button */}
      {navBack && (
        <button
          onClick={navBack.onClick}
          className="fixed top-1/2 z-10 flex flex-col items-center gap-1"
          style={{ left: 75, transform: 'translate(-50%, -50%)' }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition hover:bg-background">
            ←
          </div>
          <span className="text-xs text-muted">{navBack.label}</span>
        </button>
      )}

      {/* Forward button */}
      {navForward && (
        <button
          onClick={navForward.disabled ? undefined : navForward.onClick}
          disabled={navForward.disabled}
          className="fixed top-1/2 z-10 flex flex-col items-center gap-1"
          style={{ right: 75, transform: 'translate(50%, -50%)' }}
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition ${
              navForward.disabled
                ? 'border-border bg-background text-muted opacity-60 cursor-not-allowed'
                : 'border-border bg-surface text-foreground hover:bg-background'
            }`}
          >
            →
          </div>
          <span className={`text-xs ${navForward.disabled ? 'text-muted opacity-60' : 'text-muted'}`}>
            {navForward.label}
          </span>
        </button>
      )}

      {/* Shift content up by half the header height to center on the viewport */}
      <div
        className="flex h-full items-center"
        style={{ transform: `translateY(${offset}px)` }}
      >
        <div className="relative w-full" style={{ aspectRatio: '15/8' }}>
          <div className="absolute inset-0 flex gap-[10px]">
            <div className="flex w-1/4 flex-col gap-[10px]">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
                <p className="shrink-0 flex min-h-11 items-center border-b border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted">
                  Instructions
                </p>
                <div className="flex-1 overflow-y-auto p-4 text-sm text-muted">{instructions}</div>
              </div>
              {settings && (
                <div className="flex max-h-[50%] shrink flex-col justify-center gap-[10px] overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-md">
                  {settings}
                </div>
              )}
            </div>
            <div className="flex w-3/4 flex-col">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
