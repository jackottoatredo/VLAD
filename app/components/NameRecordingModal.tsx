'use client'

import { useState } from 'react'
import Modal from './Modal'
import { slugifyPart } from '@/lib/naming'

type SubmitResult = { ok: true; name: string } | { ok: false; error: string }

type Props = {
  title: string
  /** Slugified canonical prefix (merchant-name or product-name). Read-only display. */
  prefix: string
  /** Pre-fill the optional-tag input. Caller supplies raw text; we slugify on render. */
  defaultTag?: string
  submitLabel?: string
  /**
   * Called with the slugified tag (may be empty). The server reserves the
   * final compound name (`{prefix}-{tag}-{count}`) and returns it; resolve
   * this promise with the resolved name.
   */
  onSubmit: (tag: string) => Promise<SubmitResult>
  onCancel: () => void
}

export default function NameRecordingModal({
  title,
  prefix,
  defaultTag = '',
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: Props) {
  const [tag, setTag] = useState(slugifyPart(defaultTag))
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const previewName = tag ? `${prefix}-${tag}` : prefix

  async function handleSubmit() {
    if (busy) return
    setBusy(true)
    setServerError(null)
    const res = await onSubmit(tag)
    if (!res.ok) {
      setServerError(res.error)
      setBusy(false)
      return
    }
    // Parent closes modal on success.
  }

  return (
    <Modal title={title} onClose={() => (busy ? null : onCancel())}>
      <p className="text-sm text-muted">
        Add an optional tag to keep this recording organized. The name is
        deduplicated automatically.
      </p>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-foreground">{prefix}-</span>
        <input
          autoFocus
          type="text"
          value={tag}
          onChange={(e) => setTag(slugifyPart(e.target.value))}
          placeholder="optional tag"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-1.5 text-slate-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-inner outline-none focus:border-gray-400 dark:focus:border-gray-500"
        />
      </div>

      <p className="mt-2 text-xs text-muted">
        Will save as <span className="font-mono text-foreground">{previewName}</span>
        {' '}(a <span className="font-mono">-2</span>, <span className="font-mono">-3</span>… suffix is added if this name is already taken).
      </p>

      {serverError && (
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
          disabled={busy}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </Modal>
  )
}
