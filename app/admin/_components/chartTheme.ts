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
  ORANGE: '#f97316', // accent: new users, renders, internal traffic
  BLUE: '#3b82f6',   // calm primary: returning users, intros, direct visits
  TEAL: '#14b8a6',   // cool complement: products, email referrals
  CYAN: '#06b6d4',   // cool tertiary: efficiency ratio, twitter
  INDIGO: '#6366f1', // cool extra slice: linkedin
  VIOLET: '#8b5cf6', // cool extra slice: slack
  GREEN: '#10b981',  // positive: success rate
  SLATE: '#64748b',  // neutral: "Other" / localhost / unknown bucket
} as const

// Deterministic key → color for charts whose categories are dynamic (e.g.
// product names that can be added/removed/renamed). Keys present in the
// explicit map win; everything else hashes to a fallback color, so the
// same key always renders in the same color regardless of count order
// or which other categories happen to be present.
export function pickStableColor(
  key: string,
  explicit: Record<string, string>,
  fallback: readonly string[],
): string {
  if (key in explicit) return explicit[key]
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0
  }
  return fallback[Math.abs(h) % fallback.length]
}
