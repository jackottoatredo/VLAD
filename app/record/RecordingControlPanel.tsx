'use client'
import { useEffect, useState } from 'react'

type Props = {
  isRecording: boolean
  onStart: (sessionName: string, presenter: string) => void
  onStop: () => void
}

const PRESENTER_PATTERN = /^[a-zA-Z]+_[a-zA-Z]+$/

export default function RecordingControlPanel({ isRecording, onStart, onStop }: Props) {
  const [name, setName] = useState('')
  const [presenter, setPresenter] = useState('')
  const [sessionExists, setSessionExists] = useState(false)

  const presenterValid = presenter === '' || PRESENTER_PATTERN.test(presenter)

  useEffect(() => {
    const safeName = name.trim().replace(/[^a-z0-9_\-]/gi, '_')
    if (!safeName) { setSessionExists(false); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/list-recordings')
        const data = await res.json() as { recordings: { name: string }[] }
        setSessionExists(data.recordings.some((r) => r.name === safeName))
      } catch {
        setSessionExists(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [name])

  return (
    <div className="flex h-[12vw] flex-col justify-center gap-2 overflow-hidden rounded-xl border border-zinc-200 px-[1.5vw] dark:border-zinc-700">
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={presenter}
          onChange={(e) => setPresenter(e.target.value)}
          placeholder="lastname_firstname"
          disabled={isRecording}
          className={`w-full rounded-md border bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-100 ${
            presenterValid
              ? 'border-zinc-300 focus:border-zinc-500 dark:border-zinc-700'
              : 'border-red-400 focus:border-red-500 dark:border-red-500'
          }`}
        />
        {!presenterValid && (
          <p className="text-xs text-red-500">Must follow lastname_firstname</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Session name"
          disabled={isRecording}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {sessionExists && (
          <p className="text-xs text-yellow-500">Will replace existing recording</p>
        )}
      </div>

      <div className="flex w-full items-center gap-2">
        <button
          onClick={isRecording ? onStop : () => onStart(name.trim(), presenter.trim())}
          disabled={!isRecording && (!name.trim() || !PRESENTER_PATTERN.test(presenter))}
          className="w-full rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isRecording ? 'Stop' : 'Start Recording'}
        </button>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-sm text-red-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Recording
          </span>
        )}
      </div>
    </div>
  )
}
