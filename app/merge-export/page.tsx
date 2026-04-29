'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import DeleteModal from '@/app/components/DeleteModal'
import PreviewModal from '@/app/components/PreviewModal'
import Markdown from '@/app/components/Markdown'
import { mergeExport as mergeExportInstructions } from '@/app/copy/instructions'
import {
  initialMergeSteps,
  initialProductOnlySteps,
  startMergeJob,
  startProductOnlyJob,
  pollJob,
  JobMissingError,
  type PipelineStep,
} from './pipeline'
import GenerateMergeModal, { type MergeFormState } from './GenerateMergeModal'

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

type JobRequest = { endpoint: string; body: unknown }

type Render = {
  id: string
  brand: string | null
  video_url: string | null
  slug: string | null
  poster_key: string | null
  gif_key: string | null
  status: 'pending' | 'rendering' | 'done' | 'error'
  progress: number
  seen: boolean
  stale: boolean
  job_id: string | null
  job_request: JobRequest | null
  created_at: string
  /** Transient — populated by the poll loop while status === 'rendering'. Not from DB. */
  liveSteps?: PipelineStep[]
}

function initialStepsForEndpoint(endpoint: string | null | undefined): PipelineStep[] {
  if (endpoint === '/api/product-only-export') return initialProductOnlySteps()
  return initialMergeSteps()
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: 'recording' | 'render' } | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ title: string; videoUrl?: string | null; renderId?: string; downloadName?: string; onEdit?: () => void; trimStartSec?: number; trimEndSec?: number; slug?: string | null } | null>(null)

  // Tracks renderIds currently being polled so the resume effect doesn't
  // double up when the polling tick mutates the renders array.
  const pollingRef = useRef<Set<string>>(new Set())

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
    }
    setDeleteTarget(null)
  }

  function markSeen(id: string) {
    setRenders((prev) => prev.map((r) => (r.id === id ? { ...r, seen: true } : r)))
    fetch('/api/renders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  const fetchRenders = useCallback(() => {
    fetch('/api/renders')
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.renders ?? []) as Render[]
        // Seed liveSteps for any row that's still rendering so the progress
        // bar appears immediately on mount instead of waiting for the first
        // poll tick. The bar count comes from the original POST endpoint.
        const seeded = rows.map((r) =>
          r.status === 'rendering' && !r.liveSteps
            ? { ...r, liveSteps: initialStepsForEndpoint(r.job_request?.endpoint) }
            : r,
        )
        setRenders(seeded)
      })
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

  // Resume / start polling for any rendering row with a job_id. Idempotent
  // via pollingRef — the same renderId is never polled twice even though
  // this effect re-runs on every render-state mutation (including live
  // progress ticks).
  useEffect(() => {
    for (const r of renders) {
      if (r.status !== 'rendering' || !r.job_id) continue
      if (pollingRef.current.has(r.id)) continue
      pollingRef.current.add(r.id)

      const renderId = r.id
      pollJob(r.job_id, (steps) => {
        setRenders((prev) => prev.map((rr) => (rr.id === renderId ? { ...rr, liveSteps: steps } : rr)))
      })
        .then(() => {
          pollingRef.current.delete(renderId)
          // Refresh from DB to pick up the worker's UPDATE (video_url, slug,
          // poster, status='done').
          fetchRenders()
        })
        .catch((err) => {
          pollingRef.current.delete(renderId)
          if (err instanceof JobMissingError) {
            // Orphan: BullMQ job is gone (worker crash, Redis evict). Mark the
            // row as failed so the UI shows Failed + Retry.
            fetch('/api/renders', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: renderId, status: 'error' }),
            })
          }
          setRenders((prev) => prev.map((rr) => (rr.id === renderId ? { ...rr, status: 'error' } : rr)))
        })
    }
  }, [renders, fetchRenders])

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
    setPreviewTarget({
      title,
      videoUrl: recording.preview_url,
      downloadName: name,
      onEdit: () => { setPreviewTarget(null); openRecordingInEditor(recording) },
      trimStartSec,
      trimEndSec,
    })
  }

  // Optimistically insert a stub Render row matching what the API just created
  // so the UI shows the in-progress task immediately. The poll-resume effect
  // picks it up via pollingRef on the next render.
  function insertOptimistic(renderId: string, jobId: string, brand: string, endpoint: string, body: unknown) {
    const optimistic: Render = {
      id: renderId,
      brand,
      video_url: null,
      slug: null,
      poster_key: null,
      gif_key: null,
      status: 'rendering',
      progress: 0,
      seen: false,
      stale: false,
      job_id: jobId,
      job_request: { endpoint, body },
      created_at: new Date().toISOString(),
      liveSteps: initialStepsForEndpoint(endpoint),
    }
    setRenders((prev) => [optimistic, ...prev])
  }

  async function runTask(merchantRecordingId: string, productRecordingId: string) {
    const brand = `${merchantLabel(merchantRecordingId)}-${productLabel(productRecordingId)}`
    try {
      const { jobId, renderId } = await startMergeJob(merchantRecordingId, productRecordingId, brand)
      insertOptimistic(renderId, jobId, brand, '/api/merge-export', { merchantRecordingId, productRecordingId, brand })
    } catch {
      // The user has no row to retry — surface an inline error via a transient
      // failed entry would require a fake id. Rely on the modal-level UX.
    }
  }

  async function runProductOnlyTask(
    productRecordingId: string,
    merchantBrand: { websiteUrl: string; brandName: string },
  ) {
    const merchantLabelText = merchantBrand.brandName || merchantBrand.websiteUrl
    const productLabelText = productLabel(productRecordingId)
    const brand = `${merchantLabelText}-${productLabelText}`
    try {
      const result = await startProductOnlyJob(productRecordingId, merchantBrand)
      if ('cached' in result && result.cached) {
        // Cache hit — server inserted a 'done' row directly. Refresh.
        fetchRenders()
        return
      }
      const { jobId, renderId } = result
      insertOptimistic(renderId, jobId, brand, '/api/product-only-export', { productRecordingId, merchantBrand })
    } catch {
      /* see runTask comment */
    }
  }

  async function retry(render: Render) {
    if (!render.job_request) return
    const { endpoint, body } = render.job_request
    // Drop the failed row first so the retried task replaces it visually.
    setRenders((prev) => prev.filter((r) => r.id !== render.id))
    fetch('/api/renders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: render.id }),
    })
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return
      const data = (await res.json()) as
        | { cached: true; renderId: string; videoR2Key: string }
        | { jobId: string; renderId: string }
      if ('cached' in data && data.cached === true) {
        fetchRenders()
        return
      }
      const job = data as { jobId: string; renderId: string }
      insertOptimistic(job.renderId, job.jobId, render.brand ?? 'Render', endpoint, body)
    } catch { /* swallow */ }
  }

  function handleGenerate(state: MergeFormState) {
    if (state.preset === 'p1' && state.intro.enabled && state.product.enabled) {
      const prodId = state.product.productRecordingId
      for (const merchantId of state.intro.merchantRecordingIds) {
        runTask(merchantId, prodId)
      }
    } else if (state.preset === 'p2' && state.product.enabled) {
      const prodId = state.product.productRecordingId
      // Only dispatch DB-matched merchants whose scrape is complete. Pending /
      // incomplete scrapes and free-text URL chips need a finished scrape
      // first, so they're held back and surfaced via the chip's tooltip
      // action. The modal's button count mirrors this filter.
      for (const chip of state.product.brandMerchants) {
        if (chip.kind === 'merchant' && chip.status === 'complete') {
          runProductOnlyTask(prodId, { websiteUrl: chip.websiteUrl, brandName: chip.brandName })
        }
      }
    }
    // Custom preset is banner-blocked at the modal level; nothing to do here.
    setShowGenerateModal(false)
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
                {renders.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">No exports yet.</p>
                )}
                {renders.map((r) => {
                  const label = r.brand ?? r.id.slice(0, 8)
                  const isNew = r.status === 'done' && !r.seen
                  const isInProgress = r.status === 'rendering' || r.status === 'pending'
                  const steps = r.liveSteps ?? initialStepsForEndpoint(r.job_request?.endpoint)
                  const currentStep = isInProgress
                    ? steps.find((s) => s.progress < 100) ?? steps[steps.length - 1]
                    : null

                  function openPreview() {
                    if (r.status !== 'done') return
                    if (isNew) markSeen(r.id)
                    setPreviewTarget({ title: `Export: ${label}`, videoUrl: r.video_url, renderId: r.id, downloadName: label, slug: r.slug })
                  }

                  return (
                    <div
                      key={r.id}
                      className="group relative flex h-10 items-center justify-between border-b border-border px-4 transition-colors hover:bg-background"
                      onDoubleClick={openPreview}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />}
                        <p className="min-w-0 truncate text-sm text-muted">{label}</p>
                      </span>

                      {r.status === 'error' ? (
                        <span className="ml-3 flex shrink-0 items-center gap-2">
                          <span className="text-xs text-red-500">Failed</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); retry(r) }}
                            className="text-xs text-muted hover:text-foreground"
                          >
                            Retry
                          </button>
                        </span>
                      ) : isInProgress && currentStep ? (
                        <span className="ml-3 shrink-0 text-xs text-muted opacity-70">{currentStep.label}</span>
                      ) : r.status === 'done' ? (
                        <>
                          {r.stale && (
                            <span className="mr-2 shrink-0 rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Outdated</span>
                          )}
                          <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); openPreview() }}
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
                        </>
                      ) : null}

                      {isInProgress && (
                        <div className="absolute bottom-0 left-0 right-0 flex h-[2px] gap-[2px]">
                          {steps.map((step) => (
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
                })}
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
          slug={previewTarget.slug}
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
        <GenerateMergeModal
          merchants={merchants.map((r) => ({ id: r.id, label: r.name ?? r.id.slice(0, 8) }))}
          products={products.map((r) => ({ id: r.id, label: r.name ?? r.id.slice(0, 8) }))}
          onClose={() => setShowGenerateModal(false)}
          onSubmit={handleGenerate}
        />
      )}
    </div>
  )
}
