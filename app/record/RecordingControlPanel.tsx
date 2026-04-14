'use client'
import { useEffect, useState } from 'react'
import WebcamControls from '@/app/components/WebcamControls'
import { useAppContext } from '@/app/appContext'

type Props = {
  isRecording: boolean
  onStart: (sessionName: string, presenter: string) => void
  onStop: () => void
}

const PRODUCTS = [
  { label: 'Returns & Claims', safe: 'returns-claims' },
  { label: 'Chargebacks', safe: 'chargebacks' },
  { label: 'Recover', safe: 'recover'},
  { label: 'Checkout Optimization', safe: 'checkout-optimization' },
  { label: 'Email & SMS', safe: 'email-sms' },
  { label: 'Order Editing', safe: 'order-editing' },
  { label: 'Shipping & Fulfillment', safe: 'shipping-fulfillment' },
  { label: 'Order Tracking', safe: 'order-tracking' },
  { label: 'AI Sales Support', safe: 'ai-sales-support' },
  { label: 'Warranties', safe: 'warranties' },
  { label: 'Inventory Management', safe: 'inventory-management' },
  { label: 'Agentic Catalog', safe: 'agentic-catalog' }
]

export default function RecordingControlPanel({ isRecording, onStart, onStop }: Props) {
  const {
    users, addUser,
    product: productDraft,
    setProductPresenter, setProductProduct, setProductWebcamSettings,
  } = useAppContext()

  const [sessionExists, setSessionExists] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [addError, setAddError] = useState('')

  const { presenter, product, session: sessionName, webcamSettings } = productDraft

  useEffect(() => {
    if (!sessionName) { setSessionExists(false); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/list-recordings')
        const data = await res.json() as { recordings: { name: string }[] }
        setSessionExists(data.recordings.some((r) => r.name === sessionName))
      } catch {
        setSessionExists(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [sessionName])

  async function handleAddUser() {
    setAddError('')
    const res = await fetch('/api/add-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
    })
    const data = await res.json() as { ok?: boolean; userId?: string; error?: string }
    if (!res.ok || !data.ok) {
      setAddError(data.error ?? 'Failed to add user.')
      return
    }
    const newId = data.userId!
    addUser(newId)
    setProductPresenter(newId)
    setFirstName('')
    setLastName('')
    setShowModal(false)
  }

  return (
    <>
      <div className="flex gap-1">
        <select
          value={presenter}
          onChange={(e) => setProductPresenter(e.target.value)}
          disabled={isRecording}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">Select presenter…</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button
          onClick={() => setShowModal(true)}
          disabled={isRecording}
          className="flex items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Add new user"
        >
          +
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <select
          value={product}
          onChange={(e) => setProductProduct(e.target.value)}
          disabled={isRecording}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">Select product…</option>
          {PRODUCTS.map((p) => (
            <option key={p.safe} value={p.safe}>{p.label}</option>
          ))}
        </select>
        {sessionExists && (
          <p className="text-xs text-yellow-500">Will replace existing recording</p>
        )}
      </div>

      <WebcamControls
        settings={webcamSettings}
        onChange={setProductWebcamSettings}
        disabled={isRecording}
      />

      <button
        onClick={isRecording ? onStop : () => onStart(sessionName, presenter)}
        disabled={!isRecording && !sessionName}
        className={`w-full rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed text-white ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'
        }`}
      >
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Add New User</h2>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowModal(false); setFirstName(''); setLastName(''); setAddError('') }}
                  className="flex-1 rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddUser}
                  disabled={!firstName.trim() || !lastName.trim()}
                  className="flex-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
