'use client'

import { useEffect, useState } from 'react'
import Select from '@/app/components/Select'

type MeetingLink = {
  id: string
  name: string
  slug: string
  link: string
  type: string
  organizerUserId: string
  defaultLink: boolean
}

type Mode = 'website_form' | 'hidden' | 'hubspot'

type FetchOk = {
  links: MeetingLink[]
  selectedMode: Mode
  selectedId: string | null
  reason?: 'no_hubspot_user' | 'missing_scope'
}

type State =
  | { kind: 'loading' }
  | ({ kind: 'ready' } & FetchOk)
  | { kind: 'error'; message: string; selectedMode: Mode }

const WEBSITE_FORM_VALUE = '__website_form__'
const HIDDEN_VALUE = '__hidden__'

type Props = {
  initialMode: Mode
  /** Pre-select this meeting id in the dropdown. Used in the admin flow so
   *  the admin's currently saved meeting (if any) appears selected when they
   *  pick the rep that owns it. Ignored unless initialMode='hubspot'. */
  initialSelectedId?: string | null
  /** Admin-only: load meeting links from this rep's HubSpot user instead
   *  of the session user. Saving (PATCH) still targets the session user
   *  — admins use this to use another rep's link as their own. */
  linksSourceEmail?: string | null
}

export default function HubSpotMeetingSetting({
  initialMode,
  initialSelectedId = null,
  linksSourceEmail = null,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // GET appends ?email=<other> when admin is browsing another rep's links.
  // PATCH always targets /me — saving propagates to the caller's own row.
  const linksQueryParam = linksSourceEmail
    ? `?email=${encodeURIComponent(linksSourceEmail)}`
    : ''

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/hubspot/meeting-links${linksQueryParam}`, {
          cache: 'no-store',
        })
        const body = (await res.json().catch(() => ({}))) as Partial<FetchOk> & {
          error?: string
        }
        if (cancelled) return
        // When sourcing links from another rep, the GET's selectedMode/selectedId
        // describe THAT rep's saved choice — not ours. Use props instead so the
        // dropdown reflects the admin's own saved state.
        const selectedMode: Mode = linksSourceEmail
          ? initialMode
          : ((body.selectedMode as Mode | undefined) ?? initialMode)
        const selectedId = linksSourceEmail
          ? initialSelectedId
          : (body.selectedId ?? null)
        if (!res.ok && body.reason !== 'missing_scope') {
          setState({ kind: 'error', message: body.error ?? `HTTP ${res.status}`, selectedMode })
          return
        }
        setState({
          kind: 'ready',
          links: Array.isArray(body.links) ? body.links : [],
          selectedMode,
          selectedId,
          reason: body.reason,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Network error',
          selectedMode: initialMode,
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [initialMode, initialSelectedId, linksSourceEmail, linksQueryParam])

  async function persist(payload:
    | { mode: 'website_form' }
    | { mode: 'hidden' }
    | { mode: 'hubspot'; id: string; link: string; name: string }) {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/users/me/hubspot-meeting', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      throw err
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <p className="text-sm text-muted">
        {linksSourceEmail
          ? `Loading meeting links for ${linksSourceEmail}…`
          : 'Loading your HubSpot meeting links…'}
      </p>
    )
  }

  // We always render the dropdown — even on error / no-user / no-links —
  // so the rep can still pick "website form" or "hidden". The contextual
  // helper text below the dropdown explains why HubSpot links aren't there.

  const links = state.kind === 'ready' ? state.links : []
  const reason = state.kind === 'ready' ? state.reason : undefined
  const errorMessage = state.kind === 'error' ? state.message : null
  const selectedMode = state.selectedMode
  const selectedId = state.kind === 'ready' ? state.selectedId : null

  const currentValue =
    selectedMode === 'hubspot' && selectedId
      ? selectedId
      : selectedMode === 'hidden'
        ? HIDDEN_VALUE
        : WEBSITE_FORM_VALUE

  const options = [
    {
      value: WEBSITE_FORM_VALUE,
      label: 'Use Website Booking Form',
      subtitle: 'redo.com/get-started/demo — meetings randomly assigned',
    },
    {
      value: HIDDEN_VALUE,
      label: 'Do not show a booking link',
      subtitle: 'Hide the "Book a meeting" button on share pages',
    },
    ...links.map((l) => ({
      value: l.id,
      label: l.defaultLink ? `${l.name} (default)` : l.name,
      subtitle: l.link,
    })),
  ]

  async function onChange(value: string) {
    // Select is unmounted in the loading state, so this branch is unreachable
    // at runtime — narrowing here just keeps TS happy when we spread `state`.
    if (state.kind === 'loading') return
    const prev = state
    if (value === WEBSITE_FORM_VALUE) {
      const next: State =
        state.kind === 'ready'
          ? { ...state, selectedMode: 'website_form', selectedId: null }
          : { ...state, selectedMode: 'website_form' }
      setState(next)
      try {
        await persist({ mode: 'website_form' })
      } catch {
        setState(prev)
      }
      return
    }
    if (value === HIDDEN_VALUE) {
      const next: State =
        state.kind === 'ready'
          ? { ...state, selectedMode: 'hidden', selectedId: null }
          : { ...state, selectedMode: 'hidden' }
      setState(next)
      try {
        await persist({ mode: 'hidden' })
      } catch {
        setState(prev)
      }
      return
    }
    if (state.kind !== 'ready') return
    const link = state.links.find((l) => l.id === value)
    if (!link) return
    setState({ ...state, selectedMode: 'hubspot', selectedId: link.id })
    try {
      await persist({ mode: 'hubspot', id: link.id, link: link.link, name: link.name })
    } catch {
      setState(prev)
    }
  }

  return (
    <div className="space-y-2">
      <Select
        options={options}
        value={currentValue}
        placeholder="Choose what to show…"
        disabled={saving}
        onChange={onChange}
      />
      <div className="text-xs">
        {reason === 'no_hubspot_user' && (
          <p className="text-muted">
            {linksSourceEmail
              ? `We couldn’t find a HubSpot user for ${linksSourceEmail}.`
              : 'We couldn’t find a HubSpot user for your email — ask an admin to provision your seat to see your personal meeting links here.'}
          </p>
        )}
        {reason === 'missing_scope' && (
          <p className="text-muted">
            HubSpot Service Key is missing required scopes. Ask an admin to grant{' '}
            <code className="rounded bg-background px-1 text-[0.7rem]">
              settings.users.read
            </code>{' '}
            and{' '}
            <code className="rounded bg-background px-1 text-[0.7rem]">
              scheduler.meetings.meeting-link.read
            </code>
            .
          </p>
        )}
        {!reason && state.kind === 'ready' && links.length === 0 && (
          <p className="text-muted">
            {linksSourceEmail
              ? 'This rep has no HubSpot meeting links yet.'
              : 'No HubSpot meeting links found. Create one in HubSpot to make it selectable here.'}
          </p>
        )}
        {errorMessage && (
          <p className="text-red-600 dark:text-red-500">
            Couldn&rsquo;t load HubSpot meeting links: {errorMessage}
          </p>
        )}
        {saveError && <p className="text-red-600 dark:text-red-500">{saveError}</p>}
      </div>
    </div>
  )
}
