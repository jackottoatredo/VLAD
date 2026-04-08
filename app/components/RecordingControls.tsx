'use client'
import Link from 'next/link'
import { useState } from 'react'

type Props = {
  isRecording: boolean
  savedSession: string | null
  onStart: (sessionName: string) => void
  onStop: () => void
}

export default function RecordingControls({ isRecording, savedSession, onStart, onStop }: Props) {
  const [name, setName] = useState('')

  return (
    <div className="flex items-center gap-3 mb-4">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Session name"
        disabled={isRecording}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <button
        onClick={isRecording ? onStop : () => onStart(name.trim())}
        disabled={!isRecording && !name.trim()}
        className="rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isRecording ? 'Stop' : 'Start Recording'}
      </button>
      {isRecording && (
        <span className="flex items-center gap-1.5 text-sm text-red-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Recording
        </span>
      )}
      {savedSession && !isRecording && (
        <Link
          href="/render"
          className="rounded-md px-4 py-1.5 text-sm font-medium shadow-sm bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          Continue to rendering →
        </Link>
      )}
    </div>
  )
}
