'use client'

import { usePathname } from 'next/navigation'
import SideMenu from './SideMenu'

const HIDE_MENU_PATHS = [
  '/login',
  '/merchant-flow',
  '/product-flow',
  '/video-demos',
]

function shouldHide(pathname: string | null) {
  if (!pathname) return false
  return HIDE_MENU_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export default function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hide = shouldHide(pathname)

  return (
    <>
      {!hide && <SideMenu />}
      <div className={`flex min-h-screen flex-1 flex-col ${hide ? '' : 'pl-56'}`}>
        {children}
      </div>
    </>
  )
}
