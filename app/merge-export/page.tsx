'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/app/components/Modal'
import DeleteModal from '@/app/components/DeleteModal'
import MultiSelect from '@/app/components/MultiSelect'
import PreviewModal from '@/app/components/PreviewModal'
import Markdown from '@/app/components/Markdown'
import { mergeExport as mergeExportInstructions } from '@/app/copy/instructions'
import { initialSteps, runMergeJob } from './pipeline'

type Recording = {
  id: string
  type: 'product' | 'merchant'
  name: string
  product_name: string | null
  merchant_id: string | null
  preview_url: string | null
  status: 'draft' | 'saved'
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type Render = {
  id: string
  brand: string | null
  video_url: string | null
  status: 'pending' | 'rendering' | 'done' | 'error'
  progress: number
  seen: boolean
  stale: boolean
  created_at: string
}

type ActiveTask = {
  key: string
  brand: string
  merchantRecordingId: string
  productRecordingId: string
  /** Per-step progress (0-100) */
  steps: { label: string; progress: number }[]
  /** Set once the DB row is created */
  renderId?: string
  /** Optimistically set when user clicks to dismiss "new" */
  markedSeen?: boolean
  error?: string
}

export default function MergeExportPage() {
  const router = useRouter()
  const [merchants, setMerchants] = useState<Recording[]>([])
  const [products, setProducts] = useState<Recording[]>([])
  const [renders, setRenders] = useState<Render[]>([])

  function openRecordingInEditor(recording: Recording) {
    // Per design: if any local flow session of the same kind exists, wipe it so
    // hydrateFromRecording lands on a clean slate. Tab refresh on the wizard
    // still restores via localStorage; this path is explicit reopen.
    const lsKey = recording.type === 'product' ? 'vlad_product_flow' : 'vlad_merchant_flow'
    try { localStorage.removeItem(lsKey) } catch { /* ignore */ }
    router.push(`/${recording.type}-flow?recordingId=${recording.id}`)
  }

  const [selectedMerchants, setSelectedMerchants] = useState<Set<string>>(new Set())
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [modalMerchants, setModalMerchants] = useState<Set<string>>(new Set())
  const [modalProduct, setModalProduct] = useState('')
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: 'recording' | 'render' } | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ title: string; videoUrl?: string | null; renderId?: string; downloadName?: string; onEdit?: () => void; trimStartSec?: number; trimEndSec?: number } | null>(null)

  async function handleDelete() {
    if (!deleteTarget) return
    const endpoint = deleteTarget.kind === 'recording' ? '/api/recordings' : '/api/renders'
    await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    })
    if (deleteTarget.kind === 'recording') {
      setMerchants((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      setProducts((prev) => prev.filter((r) => r.id !== deleteTarget.id))
    } else {
      setRenders((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      setActiveTasks((prev) => prev.filter((t) => t.renderId !== deleteTarget.id))
    }
    setDeleteTarget(null)
  }

  function markSeen(id: string) {
    setRenders((prev) => prev.map((r) => (r.id === id ? { ...r, seen: true } : r)))
    // Also update the active task if it holds this render
    setActiveTasks((prev) => prev.map((t) => {
      if (t.renderId !== id) return t
      return { ...t, markedSeen: true }
    }))
    fetch('/api/renders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  const fetchRenders = useCallback(() => {
    fetch('/api/renders')
      .then((r) => r.json())
      .then((d) => setRenders(d.renders ?? []))
  }, [])

  useEffect(() => {
    fetch('/api/recordings?type=merchant')
      .then((r) => r.json())
      .then((d) => setMerchants(d.recordings ?? []))
    fetch('/api/recordings?type=product')
      .then((r) => r.json())
      .then((d) => setProducts(d.recordings ?? []))
    fetchRenders()
  }, [fetchRenders])

  function toggleMerchant(id: string) {
    setSelectedMerchants((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function merchantLabel(id: string) {
    return merchants.find((m) => m.id === id)?.name ?? id.slice(0, 8)
  }

  function productLabel(id: string) {
    return products.find((p) => p.id === id)?.name ?? id.slice(0, 8)
  }

  function openRecordingPreview(recording: Recording, title: string) {
    const name = recording.type === 'merchant'
      ? `merchant-intro-${recording.name ?? recording.id.slice(0, 8)}`
      : `product-recording-${recording.name ?? recording.id.slice(0, 8)}`
    const meta = recording.metadata ?? {}
    const trimStartSec = typeof meta.trimStartSec === 'number' ? meta.trimStartSec : undefined
    const trimEndSec = typeof meta.trimEndSec === 'number' ? meta.trimEndSec : undefined
    // Pass the R2 key directly — PreviewModal streams via /api/stream?key=...
    setPreviewTarget({
      title,
      videoUrl: recording.preview_url,
      downloadName: name,
      onEdit: () => { setPreviewTarget(null); openRecordingInEditor(recording) },
      trimStartSec,
      trimEndSec,
    })
  }

  async function runTask(merchantRecordingId: string, productRecordingId: string) {
    const brand = `${merchantLabel(merchantRecordingId)}-${productLabel(productRecordingId)}`
    const key = `${merchantRecordingId}-${productRecordingId}-${Date.now()}`

    const task: ActiveTask = {
      key,
      brand,
      merchantRecordingId,
      productRecordingId,
      steps: initialSteps(),
    }

    setActiveTasks((prev) => [...prev, task])

    try {
      const result = await runMergeJob(
        merchantRecordingId,
        productRecordingId,
        brand,
        (steps) => {
          setActiveTasks((prev) =>
            prev.map((t) => (t.key === key ? { ...t, steps } : t))
          )
        },
      )

      // Stash the DB id so the unified list can swap the active entry for the DB row
      setActiveTasks((prev) => prev.map((t) => (t.key === key ? { ...t, renderId: result.renderId } : t)))
      // Refresh renders from DB to pick up the new entry
      fetchRenders()
    } catch {
      setActiveTasks((prev) =>
        prev.map((t) => (t.key === key ? { ...t, error: 'Render failed' } : t))
      )
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const prodId = modalProduct
    for (const merchantId of modalMerchants) {
      runTask(merchantId, prodId)
    }
    setShowGenerateModal(false)
    setModalMerchants(new Set())
    setModalProduct('')
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background font-sans" style={{ padding: '0 150px' }}>
      <div className="relative w-full" style={{ aspectRatio: '15/8' }}>
        <div className="absolute inset-0 flex gap-[10px]">
            {/* Instructions */}
            <div className="flex min-h-0 w-1/4 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <p className="shrink-0 flex min-h-11 items-center border-b border-border px-4 text-xs font-semibold uppercase tracking-wider text-muted">
                Instructions
              </p>
              <div className="flex-1 overflow-y-auto p-4">
                <Markdown>{mergeExportInstructions}</Markdown>
              </div>
            </div>

            {/* Column A — Merchant Recordings */}
            <div className="flex w-1/4 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Merchant Intros
                </h2>
                <button
                  type="button"
                  onClick={() => router.push('/merchant-flow')}
                  className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted transition-colors hover:border-muted hover:text-foreground"
                >
                  <span className="text-sm leading-none">+</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {merchants.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => toggleMerchant(r.id)}
                    onDoubleClick={() => openRecordingPreview(r, `Merchant Intro: ${r.name ?? r.merchant_id ?? r.id.slice(0, 8)}`)}
                    className={`group flex h-10 w-full cursor-pointer items-center justify-between border-b border-border px-4 text-sm transition-colors ${
                      selectedMerchants.has(r.id)
                        ? 'bg-background text-foreground'
                        : 'text-muted hover:bg-background hover:text-foreground'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name ?? r.merchant_id ?? r.id.slice(0, 8)}</span>
                    {r.status === 'draft' && (
                      <span className="ml-2 shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Draft</span>
                    )}
                    <span className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); openRecordingPreview(r, `Merchant Intro: ${r.name ?? r.merchant_id ?? r.id.slice(0, 8)}`) }}
                        className="text-muted hover:text-foreground"
                        title="Preview"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: r.name ?? r.merchant_id ?? r.id.slice(0, 8), kind: 'recording' }) }}
                        className="text-muted hover:text-red-500"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </span>
                  </div>
                ))}
                {merchants.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">No merchant recordings yet.</p>
                )}
              </div>
            </div>

            {/* Column B — Product Recordings */}
            <div className="flex w-1/4 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Product Recordings
                </h2>
                <button
                  type="button"
                  onClick={() => router.push('/product-flow')}
                  className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted transition-colors hover:border-muted hover:text-foreground"
                >
                  <span className="text-sm leading-none">+</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {products.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedProduct(r.id === selectedProduct ? null : r.id)}
                    onDoubleClick={() => openRecordingPreview(r, `Product Recording: ${r.name ?? r.product_name ?? r.id.slice(0, 8)}`)}
                    className={`group flex h-10 w-full cursor-pointer items-center justify-between border-b border-border px-4 text-sm transition-colors ${
                      selectedProduct === r.id
                        ? 'bg-background text-foreground'
                        : 'text-muted hover:bg-background hover:text-foreground'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name ?? r.product_name ?? r.id.slice(0, 8)}</span>
                    {r.status === 'draft' && (
                      <span className="ml-2 shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Draft</span>
                    )}
                    <span className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); openRecordingPreview(r, `Product Recording: ${r.name ?? r.product_name ?? r.id.slice(0, 8)}`) }}
                        className="text-muted hover:text-foreground"
                        title="Preview"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: r.name ?? r.product_name ?? r.id.slice(0, 8), kind: 'recording' }) }}
                        className="text-muted hover:text-red-500"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </span>
                  </div>
                ))}
                {products.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">No product recordings yet.</p>
                )}
              </div>
            </div>

            {/* Column C — Renders */}
            <div className="flex w-1/4 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Rendering Tasks
                </h2>
                <button
                  onClick={() => setShowGenerateModal(true)}
                  className="flex h-5 w-5 items-center justify-center rounded border border-border text-muted transition-colors hover:border-muted hover:text-foreground"
                >
                  <span className="text-sm leading-none">+</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {(() => {
                  // Build a unified list: active tasks first, then DB renders that aren't already represented by an active task
                  const completedIds = new Set(activeTasks.map((t) => t.renderId).filter(Boolean))
                  type ExportEntry =
                    | { kind: 'active'; task: ActiveTask }
                    | { kind: 'db'; render: Render }
                  const entries: ExportEntry[] = [
                    ...activeTasks.map((task): ExportEntry => ({ kind: 'active', task })),
                    ...renders
                      .filter((r) => !completedIds.has(r.id))
                      .map((render): ExportEntry => ({ kind: 'db', render })),
                  ]

                  if (entries.length === 0) {
                    return <p className="px-4 py-3 text-xs text-muted opacity-70">No exports yet.</p>
                  }

                  return entries.map((entry, i) => {
                    const border = ' border-b border-border'

                    if (entry.kind === 'active') {
                      const { task } = entry
                      const inProgress = !task.renderId && !task.error
                      const currentStep = inProgress
                        ? task.steps.find((s) => s.progress < 100) ?? task.steps[task.steps.length - 1]
                        : null
                      const isNew = task.renderId && !task.markedSeen
                      const isComplete = !!task.renderId

                      function openActivePreview() {
                        if (isNew) markSeen(task.renderId!)
                        setPreviewTarget({ title: `Export: ${task.brand}`, videoUrl: renders.find((r) => r.id === task.renderId)?.video_url, renderId: task.renderId, downloadName: task.brand })
                      }

                      return (
                        <div
                          key={task.key}
                          className={`group relative flex h-10 items-center justify-between px-4 transition-colors hover:bg-background${border}`}
                          onDoubleClick={isComplete ? openActivePreview : undefined}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />}
                            <p className="min-w-0 truncate text-sm text-muted">{task.brand}</p>
                          </span>
                          {task.error ? (
                            <span className="ml-3 flex shrink-0 items-center gap-2">
                              <span className="text-xs text-red-500">Failed</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveTasks((prev) => prev.filter((t) => t.key !== task.key))
                                  runTask(task.merchantRecordingId, task.productRecordingId)
                                }}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                Retry
                              </button>
                            </span>
                          ) : currentStep ? (
                            <span className="ml-3 shrink-0 text-xs text-muted opacity-70">{currentStep.label}</span>
                          ) : isComplete ? (
                            <span className="ml-3 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                onClick={(e) => { e.stopPropagation(); openActivePreview() }}
                                className="text-muted hover:text-foreground"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.renderId!, name: task.brand, kind: 'render' }) }}
                                className="text-muted hover:text-red-500"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                              </button>
                            </span>
                          ) : null}
                          {inProgress && (
                            <div className="absolute bottom-0 left-0 right-0 flex h-[2px] gap-[2px]">
                              {task.steps.map((step) => (
                                <div key={step.label} className="flex-1 bg-border">
                                  <div
                                    className="h-full bg-muted transition-all duration-100"
                                    style={{ width: `${Math.round(step.progress)}%` }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    }

                    const { render: r } = entry
                    const isNew = !r.seen
                    const label = r.brand ?? r.id.slice(0, 8)

                    function openDbPreview() {
                      if (isNew) markSeen(r.id)
                      setPreviewTarget({ title: `Export: ${label}`, videoUrl: r.video_url, renderId: r.id, downloadName: label })
                    }

                    return (
                      <div
                        key={r.id}
                        className={`group flex h-10 items-center justify-between px-4 transition-colors hover:bg-background${border}`}
                        onDoubleClick={openDbPreview}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />}
                          <p className="min-w-0 truncate text-sm text-muted">{label}</p>
                        </span>
                        {r.stale && (
                          <span className="mr-2 shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Outdated</span>
                        )}
                        <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDbPreview() }}
                            className="text-muted hover:text-foreground"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: label, kind: 'render' }) }}
                            className="text-muted hover:text-red-500"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                          </button>
                        </span>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
        </div>
      </div>

      {previewTarget && (
        <PreviewModal
          title={previewTarget.title}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.downloadName}
          trimStartSec={previewTarget.trimStartSec}
          trimEndSec={previewTarget.trimEndSec}
          onClose={() => setPreviewTarget(null)}
          onEdit={previewTarget.onEdit}
          onDelete={previewTarget.renderId ? () => {
            setDeleteTarget({ id: previewTarget.renderId!, name: previewTarget.title, kind: 'render' })
            setPreviewTarget(null)
          } : undefined}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {showGenerateModal && (
        <Modal title="Generate New Video" onClose={() => { setShowGenerateModal(false); setModalMerchants(new Set()); setModalProduct(''); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Merchant Intros</label>
              <MultiSelect
                options={merchants.map((r) => ({ value: r.id, label: r.name ?? r.id.slice(0, 8) }))}
                selected={modalMerchants}
                onChange={setModalMerchants}
                placeholder="Select merchant intros"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Product Recording</label>
              <select
                value={modalProduct}
                onChange={(e) => setModalProduct(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
              >
                <option value="">Select a product recording</option>
                {products.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={modalMerchants.size === 0 || !modalProduct}
              className="w-full rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start {modalMerchants.size || 0} rendering task{modalMerchants.size === 1 ? '' : 's'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
