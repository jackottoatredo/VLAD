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
    <div ref={containerRef} className="h-full w-full bg-black font-sans" style={{ padding: '0 150px' }}>
      {/* Back button */}
      {navBack && (
        <button
          onClick={navBack.onClick}
          className="fixed top-1/2 z-10 flex flex-col items-center gap-1"
          style={{ left: 75, transform: 'translate(-50%, -50%)' }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800">
            ←
          </div>
          <span className="text-xs text-zinc-500">{navBack.label}</span>
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
                ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600'
                : 'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            →
          </div>
          <span className={`text-xs ${navForward.disabled ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-500'}`}>
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
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
                <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Instructions
                </p>
                <div className="flex-1 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-400">{instructions}</div>
              </div>
              {settings && (
                <div className="flex max-h-[50%] shrink flex-col justify-center gap-[10px] overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
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
