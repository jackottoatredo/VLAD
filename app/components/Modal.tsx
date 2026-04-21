'use client'

import type { ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  onClose: () => void
  size?: 'default' | 'lg'
}

export default function Modal({ title, children, onClose, size = 'default' }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full rounded-xl border border-border bg-surface p-6 shadow-md ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted transition-colors hover:text-foreground"
          >
            &times;
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
