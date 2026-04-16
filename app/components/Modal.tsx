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
      <div className={`relative w-full rounded-xl border border-zinc-700 bg-zinc-950 p-6 ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-300"
          >
            &times;
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
