'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, TrashIcon } from '@/app/components/icons'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'
import { slugifyPart } from '@/lib/naming'

export default function SaveStep() {
  const flow = useProductFlow()
  const {
    flowId,
    product,
    webcamSettings,
    trimStartSec,
    trimEndSec,
    postprocessVideoR2Key,
    name: existingName,
    origin,
  } = flow

  const isReopened = origin === 'reopened' && !!existingName
  const prefix = slugifyPart(product)
  const initialTag = (() => {
    if (existingName && prefix && existingName.startsWith(`${prefix}-`)) {
      return existingName.slice(prefix.length + 1).replace(/-(\d+)$/, '')
    }
    return ''
  })()

  const [tag, setTag] = useState(slugifyPart(initialTag))
  const [busy, setBusy] = useState(false)
  const [completedAction, setCompletedAction] = useState<'saved' | 'discarded' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const previewName = tag ? `${prefix}-${tag}` : prefix

  useEffect(() => {
    if (!completedAction) return
    const t = setTimeout(() => {
      try { localStorage.removeItem('vlad_product_flow') } catch { /* ignore */ }
      router.push('/dashboard')
    }, 2000)
    return () => clearTimeout(t)
  }, [completedAction, router])

  async function handleSave() {
    if (busy || !product || !flowId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/save-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          tag: isReopened ? '' : tag,
          status: 'saved',
          type: 'product',
          productName: product,
          previewVideoR2Key: postprocessVideoR2Key,
          webcamSettings: {
            webcamMode: webcamSettings.webcamMode,
            webcamVertical: webcamSettings.webcamVertical,
            webcamHorizontal: webcamSettings.webcamHorizontal,
          },
          metadata: { trimStartSec, trimEndSec },
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; name?: string }
      if (!res.ok || !data.ok || !data.name) {
        setError(data.error ?? 'Failed to save.')
        setBusy(false)
        return
      }
      flow.markPersisted({ name: data.name, status: 'saved' })
      setCompletedAction('saved')
    } catch {
      setError('Unexpected error.')
      setBusy(false)
    }
  }

  function handleDiscardChanges() {
    if (!flowId) return
    setCompletedAction('discarded')
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-md">
        {completedAction ? (
          <div className="flex flex-col items-center gap-4 py-8">
            {completedAction === 'saved' ? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                  <CheckIcon width={36} height={36} />
                </div>
                <p className="text-lg font-medium text-foreground">Saved successfully</p>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                  <TrashIcon width={36} height={36} />
                </div>
                <p className="text-lg font-medium text-foreground">Changes discarded</p>
              </>
            )}
            <p className="text-sm text-muted">Returning to dashboard…</p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-foreground">
              {isReopened ? 'Save Changes' : 'Save Recording'}
            </h2>

            {isReopened ? (
              <p className="text-sm text-muted">
                Saving will update <span className="font-mono text-foreground">{existingName}</span>.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Add an optional tag to keep this recording organized. The name is
                  deduplicated automatically.
                </p>
                <div className="flex items-center gap-2 text-sm">
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
                <p className="text-xs text-muted">
                  Will save as <span className="font-mono text-foreground">{previewName}</span>
                  {' '}(a <span className="font-mono">-2</span>, <span className="font-mono">-3</span>… suffix is added if this name is already taken).
                </p>
              </>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={handleSave}
              disabled={busy || !flowId || !product}
              className="mt-2 w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : isReopened ? 'Save Changes' : 'Save'}
            </button>

            {isReopened && (
              <button
                onClick={handleDiscardChanges}
                disabled={busy}
                className="w-full rounded-md border border-red-500/40 bg-surface px-4 py-1.5 text-sm font-medium text-red-500 shadow-sm hover:bg-red-500/10 disabled:opacity-50"
              >
                Discard Changes
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
