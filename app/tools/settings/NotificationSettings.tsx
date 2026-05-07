'use client'

import { useEffect, useState } from 'react'

type Prefs = {
  notify_visit: boolean
  notify_visit_summary: boolean
  notify_daily_digest: boolean
  notify_weekly_digest: boolean
}

type Key = keyof Prefs

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; prefs: Prefs }
  | { kind: 'error'; message: string }

const ROWS: { key: Key; label: string; description: string }[] = [
  {
    key: 'notify_visit',
    label: 'Live visit ping',
    description: 'DM me the moment someone opens one of my share pages.',
  },
  {
    key: 'notify_visit_summary',
    label: '5-minute visit summary',
    description:
      'Threaded reply to the live ping summarizing what the visitor did over the next 5 minutes.',
  },
  {
    key: 'notify_daily_digest',
    label: 'Daily digest',
    description: 'A roll-up at 8am Mountain Time covering yesterday across all my shares.',
  },
  {
    key: 'notify_weekly_digest',
    label: 'Weekly digest',
    description: 'A roll-up Monday at 8am Mountain Time covering the previous week.',
  },
]

export default function NotificationSettings() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [savingKey, setSavingKey] = useState<Key | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/users/me/notifications')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as Prefs
        if (!cancelled) setState({ kind: 'ready', prefs: data })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to load preferences.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(key: Key, next: boolean) {
    if (state.kind !== 'ready') return
    const prev = state.prefs
    // Optimistic update; revert on failure.
    const optimistic: Prefs = { ...prev, [key]: next }
    if (key === 'notify_visit' && next === false) {
      optimistic.notify_visit_summary = false
    }
    setState({ kind: 'ready', prefs: optimistic })
    setSavingKey(key)
    try {
      const res = await fetch('/api/users/me/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      setState({ kind: 'ready', prefs: prev })
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save preference.',
      })
    } finally {
      setSavingKey(null)
    }
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-muted">Loading…</p>
  }
  if (state.kind === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-500">{state.message}</p>
  }

  const visitOn = state.prefs.notify_visit

  return (
    <div className="space-y-1">
      {ROWS.map((row) => {
        const summaryDisabled = row.key === 'notify_visit_summary' && !visitOn
        const checked = state.prefs[row.key]
        return (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <div className={summaryDisabled ? 'opacity-50' : ''}>
              <p className="text-sm text-foreground">{row.label}</p>
              <p className="text-xs text-muted">
                {summaryDisabled
                  ? 'Requires Live visit ping to be on.'
                  : row.description}
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-foreground disabled:opacity-50"
              checked={checked}
              disabled={summaryDisabled || savingKey === row.key}
              onChange={(e) => toggle(row.key, e.target.checked)}
            />
          </div>
        )
      })}
    </div>
  )
}
