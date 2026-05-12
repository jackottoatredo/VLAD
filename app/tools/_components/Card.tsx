import type { ReactNode } from 'react'

export function CardHeader({ title, controls }: { title: string; controls?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {controls && <div className="flex flex-wrap items-center gap-3">{controls}</div>}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-md ${className}`}
    >
      {children}
    </section>
  )
}

export function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background p-4">
      <span className="text-2xl font-semibold text-foreground tabular-nums">{value}</span>
      <span className="mt-1 text-xs uppercase tracking-wider text-muted">{label}</span>
    </div>
  )
}
