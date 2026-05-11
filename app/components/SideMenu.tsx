'use client'

import { usePathname } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import { useNavigationGuard } from '@/app/contexts/NavigationGuardContext'
import { APP_ENV } from '@/app/config'

type NavItem = { href: string; label: string }

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (pathname === href) return true
  return pathname.startsWith(`${href}/`)
}

export default function SideMenu() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { tryNavigate } = useNavigationGuard()
  const isAdmin = session?.user?.role === 'admin'
  const isSignedIn = !!session?.user

  const itemBase =
    'block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors'
  const itemIdle = 'text-muted hover:bg-background hover:text-foreground'
  const itemActive = 'bg-background font-medium text-foreground'

  function navItem({ href, label }: NavItem) {
    return (
      <button
        key={href}
        type="button"
        onClick={() => tryNavigate(href)}
        className={`${itemBase} ${isActive(pathname, href) ? itemActive : itemIdle}`}
      >
        {label}
      </button>
    )
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-border bg-surface">
      {/* Section 1 — Title */}
      <div className="border-b border-border px-6 py-6">
        <button
          type="button"
          onClick={() => tryNavigate('/dashboard')}
          className="text-xl font-bold tracking-tight text-foreground"
        >
          VLAD
          {APP_ENV !== 'prod' && (
            <span className="ml-1 text-sm italic font-normal text-muted">{APP_ENV}</span>
          )}
        </button>
      </div>

      {/* Section 2 — Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          {navItem({ href: '/dashboard', label: 'Dashboard' })}
          {isSignedIn && navItem({ href: '/tools/engagement', label: 'Engagement' })}
          {isSignedIn && navItem({ href: '/tools/settings', label: 'Settings' })}
          {navItem({ href: '/docs', label: 'Docs' })}
          {navItem({ href: '/quick-links', label: 'Links' })}
          {navItem({ href: '/feature-request', label: 'Feature Request' })}
          {navItem({ href: '/bug-report', label: 'Bug Report' })}
        </div>
        {isSignedIn && isAdmin && (
          <div className="mt-3 space-y-0.5 border-t border-border pt-3">
            <div className="px-3 pb-1 text-[0.65625rem] uppercase tracking-wider text-muted">
              Admin
            </div>
            {navItem({ href: '/tools/recordings', label: 'Manage Recordings' })}
            {navItem({ href: '/tools/usage', label: 'Usage' })}
          </div>
        )}
      </nav>

      {/* Section 3 — Account */}
      <div className="border-t border-border px-3 py-3">
        {isSignedIn ? (
          <div className="space-y-1">
            <div
              className="px-3 text-[0.65625rem] text-muted truncate"
              title={session.user?.email ?? ''}
            >
              {session.user?.email}
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className={`${itemBase} ${itemIdle}`}
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => signIn()}
            className={`${itemBase} ${itemIdle}`}
          >
            Sign in
          </button>
        )}
      </div>
    </aside>
  )
}
