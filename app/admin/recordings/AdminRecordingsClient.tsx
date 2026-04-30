'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PreviewModal from '@/app/components/PreviewModal'
import DeleteModal from '@/app/components/DeleteModal'
import type { AdminRecordingRow } from '@/app/api/admin/recordings/route'

const KIND_PILL_CLASS: Record<AdminRecordingRow['kind'], string> = {
  intro: 'border-blue-500/50 text-blue-600 dark:text-blue-400',
  product: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
  render: 'border-violet-500/50 text-violet-600 dark:text-violet-400',
}

const DEBOUNCE_MS = 200

function formatDate(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

function presenterLabel(p: AdminRecordingRow['presenter']): string {
  const name = `${p.firstName} ${p.lastName}`.trim()
  return name || p.email
}

export default function AdminRecordingsClient() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AdminRecordingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<AdminRecordingRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminRecordingRow | null>(null)
  const reqIdRef = useRef(0)

  useEffect(() => {
    const id = ++reqIdRef.current
    const handle = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const url = query.trim()
          ? `/api/admin/recordings?q=${encodeURIComponent(query.trim())}`
          : '/api/admin/recordings'
        const res = await fetch(url)
        const data = (await res.json()) as { rows?: AdminRecordingRow[]; error?: string }
        if (id !== reqIdRef.current) return
        if (!res.ok) {
          setError(data.error ?? 'Search failed.')
          setRows([])
        } else {
          setRows(data.rows ?? [])
        }
      } catch {
        if (id !== reqIdRef.current) return
        setError('Search failed.')
        setRows([])
      } finally {
        if (id === reqIdRef.current) setLoading(false)
      }
    }, query ? DEBOUNCE_MS : 0)
    return () => clearTimeout(handle)
  }, [query])

  async function handleDelete() {
    if (!deleteTarget) return
    const endpoint = deleteTarget.kind === 'render' ? '/api/renders' : '/api/recordings'
    await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    })
    setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-background px-4 py-10 font-sans">
      <main className="w-full max-w-4xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Manage Recordings
            </h1>
            <h3 className="mt-1 text-muted">
              Browse every user&apos;s intros, product recordings, and renders.
            </h3>
          </div>
          <Link href="/admin" className="text-sm text-muted hover:text-foreground">
            ← Admin tools
          </Link>
        </div>

        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter: type:render presenter:jack after:2026-01-01  (or free text)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted shadow-inner outline-none focus:border-muted"
        />

        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Presenter</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.kind}:${r.id}`}
                  onClick={() => setPreviewTarget(r)}
                  className="cursor-pointer border-t border-border hover:bg-background"
                >
                  <td className="px-3 py-2 text-foreground">
                    <div>{presenterLabel(r.presenter)}</div>
                    {presenterLabel(r.presenter) !== r.presenter.email && (
                      <div className="text-xs text-muted">{r.presenter.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_PILL_CLASS[r.kind]}`}
                    >
                      {r.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.label}</td>
                  <td className="px-3 py-2 text-muted">{formatDate(r.createdAt)}</td>
                  <td className="w-10 px-2 py-2 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewTarget(r) }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-foreground"
                      title="Preview"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    {error ?? 'No matching recordings.'}
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    Searching…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {previewTarget && (
        <PreviewModal
          title={`${previewTarget.kind}: ${previewTarget.label} — ${presenterLabel(previewTarget.presenter)}`}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.label}
          trimStartSec={previewTarget.trimStartSec ?? undefined}
          trimEndSec={previewTarget.trimEndSec ?? undefined}
          slug={previewTarget.slug}
          onClose={() => setPreviewTarget(null)}
          onDelete={() => {
            setDeleteTarget(previewTarget)
            setPreviewTarget(null)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.label}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
