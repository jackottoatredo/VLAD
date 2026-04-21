'use client'

import Link from 'next/link'
import { useMerchantFlow } from '@/app/contexts/MerchantFlowContext'

export default function SavedStep() {
  const flow = useMerchantFlow()

  return (
    <div className="flex h-full w-full items-center justify-center bg-background" style={{ padding: 100 }}>
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Recording Saved
          </h2>
          <p className="mt-1 text-sm text-muted">
            Saved as <em>{flow.merchantId}</em>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={flow.reset}
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 text-left transition hover:border-muted hover:shadow-sm"
          >
            <h3 className="font-medium text-foreground">Record Another Intro</h3>
            <p className="text-xs text-muted">Start a new merchant customization flow.</p>
          </button>
          <Link
            href="/merge-export"
            onClick={() => flow.reset()}
            className="group col-span-2 flex items-stretch gap-4 rounded-xl border border-border bg-background p-5 text-left transition hover:border-muted"
          >
            <div className="flex w-1/2 flex-col gap-2">
              <h3 className="font-medium text-foreground">Merge & Export</h3>
              <p className="text-xs text-muted">Merge recordings and export final videos.</p>
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
        <div className="flex items-center pt-2 text-xs">
          <Link
            href="/"
            onClick={() => flow.reset()}
            className="text-muted transition hover:text-foreground"
          >
            {'← return to Main Menu'}
          </Link>
        </div>
      </div>
    </div>
  )
}
