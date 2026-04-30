'use client'

import { useEffect, useState } from 'react'
import Modal from '@/app/components/Modal'
import UserChipInput from './UserChipInput'
import type { AdminUser } from '@/app/api/admin/users/route'

type Props = {
  excludedUsers: string[]
  onChange: (next: string[]) => void
  onClose: () => void
}

export default function UsageSettingsModal({ excludedUsers, onChange, onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    fetch('/api/admin/users', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { users?: AdminUser[] }) => setUsers(d.users ?? []))
      .catch(() => setUsers([]))
  }, [])

  return (
    <Modal title="Dashboard settings" onClose={onClose} size="md">
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-muted">Exclude users</label>
        <UserChipInput
          value={excludedUsers}
          onChange={onChange}
          options={users}
          placeholder="Type to search users…"
        />
        <p className="text-xs text-muted">
          Excluded users are dropped from every chart and counter on this dashboard.
        </p>
      </div>
    </Modal>
  )
}
