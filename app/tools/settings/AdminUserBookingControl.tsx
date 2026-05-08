'use client'

import { useEffect, useState } from 'react'
import Select from '@/app/components/Select'
import HubSpotMeetingSetting from './HubSpotMeetingSetting'

type AdminUser = {
  id: string // email
  first_name: string
  last_name: string
  role: 'user' | 'admin'
}

type Mode = 'website_form' | 'hidden' | 'hubspot'

type Props = {
  /** The admin's own current saved mode/meeting (rendered as the dropdown's
   *  pre-selected value once a rep is picked, since saving targets /me). */
  initialMode: Mode
  initialSelectedId: string | null
}

// Two-dropdown control for admins: pick a rep, then pick from THEIR HubSpot
// meeting links. The chosen value saves to the admin's own row — admins use
// this to share a sales rep's calendar URL when they aren't a rep themselves.
export default function AdminUserBookingControl({
  initialMode,
  initialSelectedId,
}: Props) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pickedEmail, setPickedEmail] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/admin/users', { cache: 'no-store' })
        const body = (await res.json().catch(() => ({}))) as {
          users?: AdminUser[]
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setUsers(body.users ?? [])
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Network error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError) {
    return (
      <p className="text-sm text-red-600 dark:text-red-500">
        Couldn&rsquo;t load users: {loadError}
      </p>
    )
  }
  if (!users) {
    return <p className="text-sm text-muted">Loading users…</p>
  }

  const userOptions = users.map((u) => {
    const fullName = `${u.first_name} ${u.last_name}`.trim() || u.id
    return {
      value: u.id,
      label: u.role === 'admin' ? `${fullName} (admin)` : fullName,
      subtitle: u.id,
    }
  })

  return (
    <div className="space-y-2">
      <Select
        options={userOptions}
        value={pickedEmail}
        placeholder="Pick a rep whose link to use…"
        onChange={(value) => setPickedEmail(value)}
      />
      {pickedEmail ? (
        // key forces a remount on rep change so internal state (loading,
        // dropdown selection, inline errors) resets cleanly.
        <HubSpotMeetingSetting
          key={pickedEmail}
          initialMode={initialMode}
          initialSelectedId={initialSelectedId}
          linksSourceEmail={pickedEmail}
        />
      ) : (
        <p className="text-xs text-muted">
          Pick a rep above to choose one of their HubSpot meeting links.
        </p>
      )}
    </div>
  )
}
