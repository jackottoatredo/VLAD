import React from 'react'

type Props = {
  instructions: React.ReactNode
  settings: React.ReactNode
  children: React.ReactNode
}

export default function PageLayout({ instructions, settings, children }: Props) {
  return (
    <div
      className="min-h-screen bg-zinc-50 font-sans dark:bg-black"
      style={{ padding: '15vh 7.5vw' }}
    >
      <div className="flex min-h-[70vh] gap-[10px]">
        <div className="flex w-1/4 flex-col gap-[10px]">
          <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Instructions
            </p>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">{instructions}</div>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-[10px] overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            {settings}
          </div>
        </div>
        <div className="flex w-3/4 flex-col">
          {children}
        </div>
      </div>
    </div>
  )
}
