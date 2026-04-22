'use client'

import type { ReactNode } from 'react'
import { useNavigationGuard } from '@/app/contexts/NavigationGuardContext'

type Props = {
  href: string
  children: ReactNode
  className?: string
  onClick?: () => void
}

export default function GuardedLink({ href, children, className, onClick }: Props) {
  const { tryNavigate } = useNavigationGuard()
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onClick?.()
        tryNavigate(href)
      }}
    >
      {children}
    </button>
  )
}
