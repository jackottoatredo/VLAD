'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/app/contexts/UserContext'

export default function Home() {
  const { presenter, users, setPresenter, addUser } = useUser()

  const [showModal, setShowModal] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [addError, setAddError] = useState('')

  async function handleAddUser() {
    setAddError('')
    const res = await fetch('/api/add-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
    })
    const data = (await res.json()) as { ok?: boolean; userId?: string; error?: string }
    if (!res.ok || !data.ok) {
      setAddError(data.error ?? 'Failed to add user.')
      return
    }
    addUser(data.userId!)
    setPresenter(data.userId!)
    setFirstName('')
    setLastName('')
    setShowModal(false)
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 px-4 font-sans dark:bg-black">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Welcome to VLAD
          </h1>
          <h3 className="mt-1 text-zinc-500 dark:text-zinc-400">
            Video and Language Automations for Demos
          </h3>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <select
              value={presenter}
              onChange={(e) => setPresenter(e.target.value)}
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">Select presenter…</option>
              {users.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              title="Add new user"
            >
              +
            </button>
          </div>

          {presenter && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Link
                href="/product-flow"
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Product Flow</h3>
                <p className="text-xs text-zinc-500">Record, trim, preview, and save a product demo.</p>
              </Link>
              <Link
                href="/merchant-flow"
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Merchant Flow</h3>
                <p className="text-xs text-zinc-500">Record and save a merchant customization intro.</p>
              </Link>
            </div>
          )}

          {!presenter && (
            <p className="text-sm text-zinc-400">Select a presenter to get started.</p>
          )}
        </div>
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Add New User</h2>
            <div className="flex flex-col gap-3">
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowModal(false); setFirstName(''); setLastName(''); setAddError('') }} className="flex-1 rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
                <button onClick={handleAddUser} disabled={!firstName.trim() || !lastName.trim()} className="flex-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
