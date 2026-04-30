import type { CSSProperties } from 'react'

export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--foreground)',
  fontSize: 12,
}

// Chart palette built around the brand accent orange (#f97316). Orange is
// reserved for "punchy positive" slots — first-time users and renders. The
// rest are cool complements that read clearly against both light and dark
// surfaces. Green is reserved for success indicators; red is reserved for
// destructive actions and never appears in charts. Per-dashboard semantic
// aliases (e.g. COLOR_NEW = PALETTE.ORANGE) live with the consumer.
export const PALETTE = {
  ORANGE: '#f97316', // accent: new users, renders
  BLUE: '#3b82f6',   // calm primary: returning users, intros
  TEAL: '#14b8a6',   // cool complement: products
  CYAN: '#06b6d4',   // cool tertiary: efficiency ratio
  INDIGO: '#6366f1', // cool extra slice for pies
  GREEN: '#10b981',  // positive: success rate
  SLATE: '#64748b',  // neutral: "Other" bucket
} as const
