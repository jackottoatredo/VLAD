'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { APP_ENV } from '@/app/config'
import { useNavigationGuard } from '@/app/contexts/NavigationGuardContext'
import { XIcon } from './icons'
import SideMenu from './SideMenu'

const HIDE_MENU_PATHS = [
  '/login',
  '/merchant-flow',
  '/product-flow',
]

// Share pages must have no navigation chrome at all — not even an exit button
// or title that links back into the app.
const NO_CHROME_PATHS = ['/video-demos']

function matchesPath(pathname: string | null, paths: string[]) {
  if (!pathname) return false
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export default function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const noChrome = matchesPath(pathname, NO_CHROME_PATHS)
  const hide = noChrome || matchesPath(pathname, HIDE_MENU_PATHS)
  const { tryNavigate } = useNavigationGuard()
  const [collapsed, setCollapsed] = useState(false)
  const [narrow, setNarrow] = useState(false)
  // Only re-apply auto state when the viewport crosses the portrait boundary,
  // so a manual toggle isn't immediately overwritten by a no-op resize event.
  const lastPortraitRef = useRef<boolean | null>(null)

  useEffect(() => {
    function check() {
      const portrait = window.innerWidth < window.innerHeight
      setNarrow(portrait)
      if (lastPortraitRef.current !== portrait) {
        lastPortraitRef.current = portrait
        setCollapsed(portrait)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // In narrow mode the expanded menu overlays content instead of pushing it.
  const pushContent = !hide && !collapsed && !narrow

  return (
    <>
      {noChrome ? null : hide ? (
        <div className="fixed left-3 top-2 z-40 flex items-center gap-2">
          <button
            type="button"
            onClick={() => tryNavigate('/dashboard')}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label="Exit flow"
          >
            <XIcon width={24} height={24} />
          </button>
          <span className="text-xl font-bold tracking-tight text-foreground">
            VLAD
            {APP_ENV !== 'prod' && (
              <span className="ml-1 text-sm italic font-normal text-muted">{APP_ENV}</span>
            )}
          </span>
        </div>
      ) : (
        <SideMenu
          collapsed={collapsed}
          narrow={narrow}
          onToggle={() => setCollapsed((c) => !c)}
        />
      )}
      {/* min-w-0 is critical: this div is the flex item inside <body>'s flex
          row. Without it, the item's default min-width: auto causes content
          like wide tables to push the entire document wider than the
          viewport, defeating overflow-x-auto inside any descendant card. */}
      <div
        className={`flex min-h-screen min-w-0 flex-1 flex-col ${pushContent ? 'pl-56' : ''}`}
        style={{ '--sidebar-width': pushContent ? '14rem' : '0px' } as CSSProperties}
      >
        {children}
      </div>
    </>
  )
}
