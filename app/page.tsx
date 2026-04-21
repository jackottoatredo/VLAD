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
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
              Welcome to VLAD
            </h1>
            <h3 className="mt-1 text-white-500 dark:text-white-400">
              <span className="font-bold text-black dark:text-white">V</span>ideo and{" "}
              <span className="font-bold text-black dark:text-white">L</span>anguage{" "}
              <span className="font-bold text-black dark:text-white">A</span>utomations for{" "}
              <span className="font-bold text-black dark:text-white">D</span>emos
            </h3>
          </div>
          {session && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {displayName}
              </span>
              <button
                onClick={() => signOut()}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        <Markdown>{homeInstructions}</Markdown>

        <div className="grid grid-cols-3 gap-4 pt-2">
          <Link
            href="/product-flow"
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Record a Product</h3>
            <p className="text-xs text-zinc-500">Create a reusable product demo and preview merchant customizations.</p>
          </Link>
          <Link
            href="/merchant-flow"
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Record an Intro</h3>
            <p className="text-xs text-zinc-500">Create an intro personalized to your target merchant.</p>
          </Link>
          <Link
            href="/merge-export"
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Merge & Export</h3>
            <p className="text-xs text-zinc-500">Join recordings into final rendered videos ready to share.</p>
          </Link>
        </div>
      </main>
    </div>
  )
}
