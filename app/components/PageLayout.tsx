import React from 'react'

type Props = {
  instructions: React.ReactNode
  settings: React.ReactNode
  children: React.ReactNode
}

export default function PageLayout({ instructions, settings, children }: Props) {
  return (
    <div
      className="flex h-full w-full max-w-screen-2xl flex-col bg-zinc-50 font-sans dark:bg-black"
      style={{ padding: 100 }}
    >
      <div className="flex flex-1 gap-[10px] overflow-hidden">
        <div className="flex w-1/4 flex-col gap-[10px]">
          {/* Instructions: fills remaining space, scrolls on overflow */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Instructions
            </p>
            <div className="flex-1 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-400">{instructions}</div>
          </div>
          {/* Controls: shrinks to fit content */}
          {settings && (
            <div className="flex shrink-0 flex-col justify-center gap-[10px] overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              {settings}
            </div>
          )}
        </div>
        <div className="flex w-3/4 flex-col">
          {children}
        </div>
      </div>
    </div>
  )
}
