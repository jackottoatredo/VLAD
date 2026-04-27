'use client'

import type { ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  onClose: () => void
  size?: 'default' | 'md' | 'lg'
  /** Optional content rendered between the title and the close button. */
  headerRight?: ReactNode
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  default: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
}

export default function Modal({ title, children, onClose, size = 'default', headerRight }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full rounded-xl border border-border bg-surface p-6 shadow-md ${SIZE_CLASS[size]}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-3">
            {headerRight}
            <button
              onClick={onClose}
              className="text-muted transition-colors hover:text-foreground"
            >
              &times;
            </button>
          </div>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
