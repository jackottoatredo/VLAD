'use client'

import { useEffect, useState } from 'react'

type Prefs = {
  notify_visit: boolean
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
    label: 'Per-render engagement',
    description:
      'One Slack DM per share the first time it gets opened. The same message updates as visits, plays, downloads, link copies, booking clicks, and live-demo opens accumulate.',
  },
  {
    key: 'notify_daily_digest',
    label: 'Daily digest',
    description:
      'A roll-up at 8am Mountain Time covering yesterday across all my shares.',
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
    setState({ kind: 'ready', prefs: { ...prev, [key]: next } })
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

  return (
    <div className="space-y-1">
      {ROWS.map((row) => (
        <div
          key={row.key}
          className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0"
        >
          <div>
            <p className="text-sm text-foreground">{row.label}</p>
            <p className="text-xs text-muted">{row.description}</p>
          </div>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-foreground disabled:opacity-50"
            checked={state.prefs[row.key]}
            disabled={savingKey === row.key}
            onChange={(e) => toggle(row.key, e.target.checked)}
          />
        </div>
      ))}
    </div>
  )
}
