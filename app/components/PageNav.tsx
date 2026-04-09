'use client'
import Link from 'next/link'

type NavLink = {
  label: string
  href: string
}

type Props = {
  back?: NavLink
  forward?: NavLink
}

export default function PageNav({ back, forward }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 flex items-end justify-between p-5 pointer-events-none">
      <div className="pointer-events-auto">
        {back && (
          <Link
            href={back.href}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ← {back.label}
          </Link>
        )}
      </div>
      <div className="pointer-events-auto">
        {forward && (
          <Link
            href={forward.href}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {forward.label} →
          </Link>
        )}
      </div>
    </nav>
  )
}
