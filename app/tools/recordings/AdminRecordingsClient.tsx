'use client'

import { useEffect, useRef, useState } from 'react'
import PageLarge from '@/app/components/PageLarge'
import RecordingPreviewModal from '@/app/components/RecordingPreviewModal'
import RenderPreviewModal from '@/app/components/RenderPreviewModal'
import RenderLogModal from '@/app/components/RenderLogModal'
import DeleteModal from '@/app/components/DeleteModal'
import GenerateMergeModal, { type MergeFormState, bodyToFormState } from '@/app/dashboard/GenerateMergeModal'
import { startMergeJob, startProductOnlyJob } from '@/app/dashboard/pipeline'
import type { AdminRecordingRow } from '@/app/api/tools/recordings/route'
import {
  ExternalLinkIcon,
  FileIcon,
  TrashIcon,
} from '@/app/components/icons'

type RecordingOption = { id: string; label: string }
type ApiRecording = { id: string; type: 'merchant' | 'product'; name: string | null; product_name: string | null; merchant_id: string | null }
type EditingRender = {
  renderId: string
  targetUserId: string
  initialState: MergeFormState
  merchants: RecordingOption[]
  products: RecordingOption[]
}

function recordingLabel(r: ApiRecording): string {
  return r.name ?? r.product_name ?? r.merchant_id ?? r.id.slice(0, 8)
}

const KIND_PILL_CLASS: Record<AdminRecordingRow['kind'], string> = {
  intro: 'border-blue-500/50 text-blue-600 dark:text-blue-400',
  product: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
  render: 'border-violet-500/50 text-violet-600 dark:text-violet-400',
}

// Failed renders override the kind pill so the row reads as a failure first
// — the kind ("render") is implied by the type column anyway.
const ERROR_PILL_CLASS = 'border-red-500/50 text-red-600 dark:text-red-400'

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

// Single fixed-width slot in the row's actions column. Renders as a clickable
// icon when `available`, otherwise as a centered em-dash so the three-icon
// layout stays aligned across rows regardless of which actions apply.
function ActionSlot({
  available,
  title,
  onClick,
  icon,
}: {
  available: boolean
  title: string
  onClick: () => void
  icon: React.ReactNode
}) {
  if (!available) {
    return <span className="inline-flex h-6 w-6 items-center justify-center text-xs text-muted">—</span>
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-foreground"
      title={title}
    >
      {icon}
    </button>
  )
}

export default function AdminRecordingsClient() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AdminRecordingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<AdminRecordingRow | null>(null)
  const [logTarget, setLogTarget] = useState<AdminRecordingRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminRecordingRow | null>(null)
  // When non-null, GenerateMergeModal opens pre-populated with the owner's
  // recordings + the original render's settings. Submitting here dispatches
  // a fresh job under the original owner's account (admin override) and
  // deletes the source render.
  const [editingRender, setEditingRender] = useState<EditingRender | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  // Bumped after a re-render submit to force the rows-fetch effect to refire
  // (the effect is keyed on `query`, and re-renders don't change the query).
  const [refreshNonce, setRefreshNonce] = useState(0)
  const reqIdRef = useRef(0)

  useEffect(() => {
    const id = ++reqIdRef.current
    const handle = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const url = query.trim()
          ? `/api/tools/recordings?q=${encodeURIComponent(query.trim())}`
          : '/api/tools/recordings'
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
  }, [query, refreshNonce])

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

  // Refetch the rows panel after a re-render. Bumps the nonce so the
  // existing debounced effect re-runs without losing the active query.
  function refreshRows() {
    setRefreshNonce((n) => n + 1)
  }

  async function openRenderEdit(target: AdminRecordingRow) {
    if (target.kind !== 'render' || !target.jobRequest) return
    const initialState = bodyToFormState(target.jobRequest)
    if (!initialState) {
      setEditError('This render has no settings recorded — it predates the edit feature.')
      return
    }
    setPreviewTarget(null)
    setEditError(null)
    const ownerId = target.presenter.email
    try {
      const [merchantRes, productRes] = await Promise.all([
        fetch(`/api/recordings?type=merchant&userId=${encodeURIComponent(ownerId)}`),
        fetch(`/api/recordings?type=product&userId=${encodeURIComponent(ownerId)}`),
      ])
      if (!merchantRes.ok || !productRes.ok) throw new Error('Failed to load recordings.')
      const merchantData = (await merchantRes.json()) as { recordings?: ApiRecording[] }
      const productData = (await productRes.json()) as { recordings?: ApiRecording[] }
      const merchants: RecordingOption[] = (merchantData.recordings ?? []).map((r) => ({ id: r.id, label: recordingLabel(r) }))
      const products: RecordingOption[] = (productData.recordings ?? []).map((r) => ({ id: r.id, label: recordingLabel(r) }))
      setEditingRender({
        renderId: target.id,
        targetUserId: ownerId,
        initialState,
        merchants,
        products,
      })
    } catch (err) {
      setEditError((err as Error).message ?? 'Failed to load owner recordings.')
    }
  }

  // Mirror of the merge-export page's handleGenerate dispatch logic, but
  // sends `targetUserId` so the new render row is owned by the original
  // user. After dispatching, the source render is deleted and the table
  // refreshed.
  async function handleEditSubmit(state: MergeFormState) {
    if (!editingRender) return
    const { renderId: oldId, targetUserId } = editingRender
    const wantsBoth = state.intro.enabled && state.product.enabled
    const introOnly = state.intro.enabled && !state.product.enabled
    const productOnlyFlow = !state.intro.enabled && state.product.enabled

    const introSection = (s: typeof state.intro) => ({
      modeSource: s.modeSource,
      customMode: s.customMode,
      positionSource: s.positionSource,
      customPosition: s.customPosition,
    })
    const productSection = (s: typeof state.product) => ({
      modeSource: s.modeSource,
      customMode: s.customMode,
      positionSource: s.positionSource,
      customPosition: s.customPosition,
    })
    const transitionForApi = state.transition.enabled
      ? {
          audio: state.transition.audio,
          video: state.transition.video,
          overlay: state.transition.overlay,
          mouse: state.transition.mouse,
          audioDurationMs: state.transition.audioDurationMs,
          videoDurationMs: state.transition.videoDurationMs,
          overlayDurationMs: state.transition.overlayDurationMs,
          mouseDurationMs: state.transition.mouseDurationMs,
        }
      : {
          audio: 'none' as const,
          video: 'none' as const,
          overlay: 'none' as const,
          mouse: 'none' as const,
          audioDurationMs: state.transition.audioDurationMs,
          videoDurationMs: state.transition.videoDurationMs,
          overlayDurationMs: state.transition.overlayDurationMs,
          mouseDurationMs: state.transition.mouseDurationMs,
        }

    const dispatches: Promise<unknown>[] = []
    if (wantsBoth || introOnly) {
      const prodId = wantsBoth ? state.product.productRecordingId : null
      for (const merchantId of state.intro.merchantRecordingIds) {
        dispatches.push(
          startMergeJob({
            merchantRecordingId: merchantId,
            productRecordingId: prodId ?? undefined,
            introEnabled: true,
            productEnabled: !!prodId,
            introSettings: introSection(state.intro),
            productSettings: productSection(state.product),
            transition: transitionForApi,
            targetUserId,
          }).catch(() => {}),
        )
      }
    } else if (productOnlyFlow) {
      const prodId = state.product.productRecordingId
      for (const chip of state.product.brandMerchants) {
        if (chip.kind !== 'merchant' || chip.status !== 'complete') continue
        dispatches.push(
          startProductOnlyJob({
            productRecordingId: prodId,
            merchantBrand: { websiteUrl: chip.websiteUrl, brandName: chip.brandName },
            productSettings: productSection(state.product),
            targetUserId,
          }).catch(() => {}),
        )
      }
    }

    setEditingRender(null)
    await Promise.all(dispatches)
    await fetch('/api/renders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: oldId }),
    }).catch(() => {})
    refreshRows()
  }

  return (
    <PageLarge maxWidth="800px">
      <main className="flex h-full w-full flex-col space-y-6 overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Manage Recordings
            </h1>
            <h3 className="mt-1 text-muted">
              Browse every user&apos;s intros, product recordings, and renders.
            </h3>
          </div>
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
                <th className="w-28 px-2 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isFailedRender = r.kind === 'render' && r.status === 'error'
                // Row click defaults to "the most useful thing" — open preview
                // when available, else the log, else nothing. Explicit icons
                // remain the canonical way to invoke each action.
                const canOpen = !!r.videoUrl
                const canLog = !!r.logsAvailable
                const onRowClick = () => {
                  if (canOpen) setPreviewTarget(r)
                  else if (canLog) setLogTarget(r)
                }
                return (
                  <tr
                    key={`${r.kind}:${r.id}`}
                    onClick={onRowClick}
                    className={`border-t border-border hover:bg-background ${
                      canOpen || canLog ? 'cursor-pointer' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-foreground">
                      <div>{presenterLabel(r.presenter)}</div>
                      {presenterLabel(r.presenter) !== r.presenter.email && (
                        <div className="text-xs text-muted">{r.presenter.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          isFailedRender ? ERROR_PILL_CLASS : KIND_PILL_CLASS[r.kind]
                        }`}
                      >
                        {isFailedRender ? 'render · error' : r.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground">{r.label}</td>
                    <td className="px-3 py-2 text-muted">{formatDate(r.createdAt)}</td>
                    <td className="w-28 px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <ActionSlot
                          available={canLog}
                          title="View log"
                          onClick={() => setLogTarget(r)}
                          icon={<FileIcon width={14} height={14} />}
                        />
                        <ActionSlot
                          available={canOpen}
                          title="Open preview"
                          onClick={() => setPreviewTarget(r)}
                          icon={<ExternalLinkIcon width={14} height={14} />}
                        />
                        <ActionSlot
                          available
                          title="Delete"
                          onClick={() => setDeleteTarget(r)}
                          icon={<TrashIcon width={14} height={14} />}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
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

      {previewTarget && previewTarget.kind === 'render' && (
        <RenderPreviewModal
          title={`${previewTarget.kind}: ${previewTarget.label} — ${presenterLabel(previewTarget.presenter)}`}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.label}
          trimStartSec={previewTarget.trimStartSec ?? undefined}
          trimEndSec={previewTarget.trimEndSec ?? undefined}
          slug={previewTarget.slug}
          jobRequest={previewTarget.jobRequest}
          onClose={() => setPreviewTarget(null)}
          onEdit={previewTarget.jobRequest ? () => openRenderEdit(previewTarget) : undefined}
          onDelete={() => {
            setDeleteTarget(previewTarget)
            setPreviewTarget(null)
          }}
        />
      )}

      {previewTarget && previewTarget.kind !== 'render' && (
        <RecordingPreviewModal
          title={`${previewTarget.kind}: ${previewTarget.label} — ${presenterLabel(previewTarget.presenter)}`}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.label}
          trimStartSec={previewTarget.trimStartSec ?? undefined}
          trimEndSec={previewTarget.trimEndSec ?? undefined}
          onClose={() => setPreviewTarget(null)}
          onDelete={() => {
            setDeleteTarget(previewTarget)
            setPreviewTarget(null)
          }}
        />
      )}

      {logTarget && (
        <RenderLogModal
          renderId={logTarget.id}
          title={`${logTarget.label} — ${presenterLabel(logTarget.presenter)}`}
          onClose={() => setLogTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.label}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {editingRender && (
        <GenerateMergeModal
          merchants={editingRender.merchants}
          products={editingRender.products}
          onClose={() => setEditingRender(null)}
          onSubmit={handleEditSubmit}
          initialState={editingRender.initialState}
          submitLabel="Re-render"
          modalTitle="Edit & re-render"
        />
      )}

      {editError && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {editError}
          <button onClick={() => setEditError(null)} className="ml-3 text-xs underline">dismiss</button>
        </div>
      )}
    </PageLarge>
  )
}
