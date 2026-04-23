'use client'

import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { emailToName } from '@/lib/nameUtils'
import Markdown from '@/app/components/Markdown'
import { home as homeInstructions } from '@/app/copy/instructions'

export default function Home() {
  const { data: session } = useSession()

  const email = session?.user?.email ?? ''
  const { firstName, lastName } = emailToName(email)
  const displayName = [firstName, lastName].filter(Boolean).join(' ')

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Welcome to VLAD
            </h1>
            <h3 className="mt-1 text-muted">
              <span className="font-bold text-foreground">V</span>ideo and{" "}
              <span className="font-bold text-foreground">L</span>anguage{" "}
              <span className="font-bold text-foreground">A</span>utomations for{" "}
              <span className="font-bold text-foreground">D</span>emos
            </h3>
          </div>
          {session && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-medium text-foreground">
                {displayName}
              </span>
              <button
                onClick={() => signOut()}
                className="text-xs text-muted hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        <Markdown className="!text-foreground">{homeInstructions}</Markdown>

        <div className="grid grid-cols-3 gap-4 !mt-2">
          <Link
            href="/product-flow"
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 transition hover:border-muted hover:shadow-sm"
          >
            <h3 className="font-medium text-foreground">Record a Product</h3>
            <p className="text-xs text-muted">Create a reusable product demo and preview merchant customizations.</p>
          </Link>
          <Link
            href="/merchant-flow"
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 transition hover:border-muted hover:shadow-sm"
          >
            <h3 className="font-medium text-foreground">Record an Intro</h3>
            <p className="text-xs text-muted">Create an intro personalized to your target merchant.</p>
          </Link>
          <Link
            href="/merge-export"
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 transition hover:border-muted hover:shadow-sm"
          >
            <h3 className="font-medium text-foreground">Merge & Export</h3>
            <p className="text-xs text-muted">Join recordings into final rendered videos ready to share.</p>
          </Link>
        </div>
        <div className="flex justify-start !mt-1 -mb-5 text-xs text-foreground">
          <span>
            New here? Read the{' '}
            <Link
              href="/tutorial"
              className="underline underline-offset-2 hover:text-muted"
            >
              Tutorial
            </Link>
          </span>
        </div>
      </main>
    </div>
  )
}
