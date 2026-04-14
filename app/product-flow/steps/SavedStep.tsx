'use client'

import Link from 'next/link'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'

export default function SavedStep() {
  const flow = useProductFlow()

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black" style={{ padding: 100 }}>
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Saved to Library
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Your product recording has been saved. What would you like to do next?
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={flow.reset}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-left transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Record Another Product</h3>
            <p className="text-xs text-zinc-500">Start a new product recording flow.</p>
          </button>
          <Link
            href="/merchant-flow"
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Merchant Flow</h3>
            <p className="text-xs text-zinc-500">Record a merchant customization intro.</p>
          </Link>
          <Link
            href="/"
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Home</h3>
            <p className="text-xs text-zinc-500">Return to the main menu.</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
