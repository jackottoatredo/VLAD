'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/record': 'Product Recording',
  '/preview': 'Product Preview',
  '/merchant': 'Merchant Customization',
  '/review': 'Review & Export',
}

type NavLink = {
  label: string
  href: string
}

type Props = {
  back?: NavLink
  forward?: NavLink
}

export default function PageNav({ back, forward }: Props) {
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? ''

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-black">
      <div className="relative flex items-center justify-between px-5 py-3">
        <div>
          {back && (
            <Link
              href={back.href}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ← {back.label}
            </Link>
          )}
        </div>
        {title && (
          <span className="absolute left-1/2 -translate-x-1/2 rounded-lg border border-orange-500 px-4 py-2 text-sm font-medium text-orange-500">
            {title}
          </span>
        )}
        <div>
          {forward && (
            <Link
              href={forward.href}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {forward.label} →
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
