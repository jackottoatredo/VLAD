'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

type SubmitResult = { ok: true } | { ok: false; error: string }

type Props = {
  title: string
  prefix: string
  defaultSuffix?: string
  submitLabel?: string
  /** Called with the full compound name (prefix-suffix). Return { ok:false } with error to keep modal open. */
  onSubmit: (name: string) => Promise<SubmitResult>
  onCancel: () => void
}

function sanitizeSuffix(raw: string): string {
  return raw.replace(/[^a-z0-9_\-]/gi, '-').replace(/-+/g, '-')
}

export default function NameRecordingModal({
  title,
  prefix,
  defaultSuffix = '',
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: Props) {
  const [suffix, setSuffix] = useState(defaultSuffix)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [existsWarning, setExistsWarning] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmedSuffix = suffix.trim()
  const compound = trimmedSuffix ? `${prefix}-${trimmedSuffix}` : ''

  // Live duplicate check (debounced). We clear the warning only after fetch
  // returns — this avoids flicker and keeps the effect free of synchronous setState.
  useEffect(() => {
    if (!compound) return
    let cancelled = false
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/recordings?name=${encodeURIComponent(compound)}`)
        if (cancelled || !res.ok) return
        const data = await res.json() as { exists?: boolean }
        if (!cancelled) setExistsWarning(!!data.exists)
      } catch {
        /* ignore */
      }
    }, 300)
    debounceRef.current = timeout
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [compound])

  async function handleSubmit() {
    if (!compound || busy || existsWarning) return
    setBusy(true)
    setServerError(null)
    const res = await onSubmit(compound)
    if (!res.ok) {
      setServerError(res.error)
      setBusy(false)
      return
    }
    // Parent closes modal on success.
  }

  return (
    <Modal title={title} onClose={() => (busy ? null : onCancel())}>
      <p className="text-sm text-muted">Give this recording a name.</p>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-foreground">{prefix}-</span>
        <input
          autoFocus
          type="text"
          value={suffix}
          onChange={(e) => {
            setSuffix(sanitizeSuffix(e.target.value))
            setExistsWarning(false)
          }}
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-1.5 text-slate-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-inner outline-none focus:border-gray-400 dark:focus:border-gray-500"
        />
      </div>

      {existsWarning && (
        <p className="mt-2 text-xs text-red-500">
          A recording named &ldquo;{compound}&rdquo; already exists. Choose a different suffix.
        </p>
      )}
      {serverError && !existsWarning && (
        <p className="mt-2 text-xs text-red-500">{serverError}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!trimmedSuffix || existsWarning || busy}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </Modal>
  )
}
