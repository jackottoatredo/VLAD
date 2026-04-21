'use client'

import Link from 'next/link'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'

export default function SavedStep() {
  const flow = useProductFlow()

  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 dark:bg-black" style={{ padding: 100 }}>
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Recording Saved
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Saved as <em>{flow.product}</em>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={flow.reset}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-left transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Record Another Product</h3>
            <p className="text-xs text-zinc-500">Create a reusable product demo and preview merchant customizations.</p>
          </button>
          <Link
            href="/merchant-flow"
            onClick={() => flow.reset()}
            className="group col-span-2 flex items-stretch gap-4 rounded-xl border border-zinc-200 bg-white p-5 text-left transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-800 dark:hover:border-zinc-600"
          >
            <div className="flex w-1/2 flex-col gap-2">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Record an Intro</h3>
              <p className="text-xs text-zinc-500">Create an intro personalized to your target merchant.</p>
            </div>
            <div className="flex w-1/2 items-center justify-end pr-2">
              <svg
                viewBox="0 0 36 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-10 w-[3.75rem] transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden
              >
                <path d="M2 12h28" />
                <path d="M25 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        </div>
        <div className="flex items-center justify-between pt-2 text-xs">
          <Link
            href="/"
            onClick={() => flow.reset()}
            className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {'← back to Main Menu'}
          </Link>
          <Link
            href="/merge-export"
            onClick={() => flow.reset()}
            className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {'skip to Merge & Export →'}
          </Link>
        </div>
      </div>
    </div>
  )
}
