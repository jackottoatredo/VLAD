import type { CSSProperties } from 'react'

export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--foreground)',
  fontSize: 12,
}

// Hex codes picked to be distinct in both light and dark themes. Shared
// across admin dashboards so usage and engagement stay visually coherent.
// Per-dashboard semantic aliases (e.g. COLOR_DAU = PALETTE.BLUE) live with
// the consumer.
export const PALETTE = {
  BLUE: '#3b82f6',
  EMERALD: '#10b981',
  VIOLET: '#8b5cf6',
  AMBER: '#f59e0b',
  RED: '#ef4444',
  GREY: '#6b7280',
} as const
