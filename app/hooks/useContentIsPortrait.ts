'use client'

import { useEffect, useState } from 'react'

// Width of the persistent SideMenu (w-56 in SideMenu.tsx). Hardcoded because
// the hook would otherwise have to measure the sidebar on every resize.
const SIDEBAR_WIDTH = 224

// Returns true when the chrome content area (everything to the right of the
// side menu) is taller than it is wide. Pages use this to switch between
// landscape (multi-column) and portrait (stacked) presentations. SSR defaults
// to false; updated on mount and on window resize.
export function useContentIsPortrait() {
  const [isPortrait, setIsPortrait] = useState(false)

  useEffect(() => {
    function check() {
      const w = window.innerWidth - SIDEBAR_WIDTH
      const h = window.innerHeight
      setIsPortrait(w < h)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return isPortrait
}
