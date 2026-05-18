'use client'

import { useEffect, useState } from 'react'

type Prefs = {
  notify_visit: boolean
  notify_daily_digest: boolean
  notify_weekly_digest: boolean
  notify_new_user_signup: boolean
}

type Key = keyof Prefs

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; prefs: Prefs }
  | { kind: 'error'; message: string }

type TestStatus = 'idle' | 'sending' | { kind: 'sent' } | { kind: 'failed'; message: string }

type Row = { key: Key; label: string; description: string; adminOnly?: boolean }

const ROWS: Row[] = [
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
  {
    key: 'notify_new_user_signup',
    label: 'New user signups (admin)',
    description:
      'A Slack DM the first time a brand-new user signs into VLAD. Admin-only.',
    adminOnly: true,
  },
]

export default function NotificationSettings({ isAdmin = false }: { isAdmin?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [savingKey, setSavingKey] = useState<Key | null>(null)
  const [testStatus, setTestStatus] = useState<Record<Key, TestStatus>>({
    notify_visit: 'idle',
    notify_daily_digest: 'idle',
    notify_weekly_digest: 'idle',
    notify_new_user_signup: 'idle',
  })

  const visibleRows = ROWS.filter((row) => !row.adminOnly || isAdmin)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/users/me/notifications')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as Partial<Prefs>
        if (!cancelled) {
          setState({
            kind: 'ready',
            prefs: {
              notify_visit: !!data.notify_visit,
              notify_daily_digest: !!data.notify_daily_digest,
              notify_weekly_digest: !!data.notify_weekly_digest,
              notify_new_user_signup: !!data.notify_new_user_signup,
            },
          })
        }
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

  async function sendTest(key: Key) {
    setTestStatus((s) => ({ ...s, [key]: 'sending' }))
    try {
      const res = await fetch('/api/users/me/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        slackError?: string
        reason?: string
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.slackError ?? body.reason ?? `HTTP ${res.status}`)
      }
      setTestStatus((s) => ({ ...s, [key]: { kind: 'sent' } }))
      // Auto-clear the "sent" badge so repeat tests don't look stale.
      setTimeout(() => {
        setTestStatus((s) => (s[key] !== 'idle' && typeof s[key] !== 'string' ? { ...s, [key]: 'idle' } : s))
      }, 4000)
    } catch (err) {
      setTestStatus((s) => ({
        ...s,
        [key]: { kind: 'failed', message: err instanceof Error ? err.message : 'Test failed.' },
      }))
    }
  }

  function renderTestStatus(status: TestStatus): React.ReactElement | null {
    if (status === 'idle') return null
    if (status === 'sending') {
      return <span className="text-xs text-muted">Sending…</span>
    }
    if (status.kind === 'sent') {
      return <span className="text-xs text-emerald-600 dark:text-emerald-500">Sent ✓</span>
    }
    return (
      <span className="text-xs text-red-600 dark:text-red-500" title={status.message}>
        Failed
      </span>
    )
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-muted">Loading…</p>
  }
  if (state.kind === 'error') {
    return <p className="text-sm text-red-600 dark:text-red-500">{state.message}</p>
  }

  return (
    <div className="space-y-1">
      {visibleRows.map((row) => {
        const status = testStatus[row.key]
        const sending = status === 'sending'
        return (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{row.label}</p>
              <p className="text-xs text-muted">{row.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {renderTestStatus(status)}
              <button
                type="button"
                onClick={() => sendTest(row.key)}
                disabled={sending}
                className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send test'}
              </button>
              <input
                type="checkbox"
                className="h-4 w-4 accent-foreground disabled:opacity-50"
                checked={state.prefs[row.key]}
                disabled={savingKey === row.key}
                onChange={(e) => toggle(row.key, e.target.checked)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
