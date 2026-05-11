'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import DeleteModal from '@/app/components/DeleteModal'
import RecordingPreviewModal from '@/app/components/RecordingPreviewModal'
import RenderPreviewModal from '@/app/components/RenderPreviewModal'
import { useContentIsPortrait } from '@/app/hooks/useContentIsPortrait'
import {
  ExternalLinkIcon,
  InfoCircleIcon,
  RetryIcon,
  TrashIcon,
} from '@/app/components/icons'
import {
  initialMergeSteps,
  initialProductOnlySteps,
  startMergeJob,
  startProductOnlyJob,
  pollJob,
  JobMissingError,
  type PipelineStep,
} from './pipeline'
import GenerateMergeModal, { type MergeFormState, bodyToFormState } from './GenerateMergeModal'

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
  // When the content area is taller than wide, stack the columns vertically
  // instead of side-by-side.
  const isPortrait = useContentIsPortrait()
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
  // When non-null, GenerateMergeModal opens pre-populated for an edit. On
  // submit, the old render gets removed and a fresh job is dispatched. Stored
  // separately from showGenerateModal so the two flows don't collide on close.
  const [editingRender, setEditingRender] = useState<{ renderId: string; initialState: MergeFormState } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: 'recording' | 'render' } | null>(null)
  type PreviewTarget =
    | {
        kind: 'recording'
        title: string
        videoUrl?: string | null
        downloadName?: string
        trimStartSec?: number
        trimEndSec?: number
        onEdit?: () => void
      }
    | {
        kind: 'render'
        title: string
        videoUrl?: string | null
        downloadName?: string
        trimStartSec?: number
        trimEndSec?: number
        renderId: string
        slug?: string | null
        jobRequest?: JobRequest | null
      }
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null)

  // Tracks renderIds currently being polled so the resume effect doesn't
  // double up when the polling tick mutates the renders array.
  const pollingRef = useRef<Set<string>>(new Set())

  async function performDelete(id: string, kind: 'recording' | 'render') {
    const endpoint = kind === 'recording' ? '/api/recordings' : '/api/renders'
    await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (kind === 'recording') {
      setMerchants((prev) => prev.filter((r) => r.id !== id))
      setProducts((prev) => prev.filter((r) => r.id !== id))
    } else {
      setRenders((prev) => prev.filter((r) => r.id !== id))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await performDelete(deleteTarget.id, deleteTarget.kind)
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
      kind: 'recording',
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

  async function runTask(state: MergeFormState, merchantRecordingId: string | null, productRecordingId: string | null) {
    const merchantLabelText = merchantRecordingId ? merchantLabel(merchantRecordingId) : null
    const productLabelText = productRecordingId ? productLabel(productRecordingId) : null
    const brand = [merchantLabelText, productLabelText].filter(Boolean).join('-') || 'Render'
    const introSettings = sectionSettingsForApi(state.intro)
    const productSettings = sectionSettingsForApi(state.product)
    const body = {
      merchantRecordingId: merchantRecordingId ?? undefined,
      productRecordingId: productRecordingId ?? undefined,
      introEnabled: !!merchantRecordingId,
      productEnabled: !!productRecordingId,
      introSettings,
      productSettings,
      // The master `enabled` toggle gates the wire payload — when off, all
      // four types submit as 'none' regardless of the stored values. The
      // stored values themselves are preserved (the modal toggle never
      // mutates them) so the user's selections come back on re-enable.
      transition: state.transition.enabled
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
            audio: 'none',
            video: 'none',
            overlay: 'none',
            mouse: 'none',
            audioDurationMs: state.transition.audioDurationMs,
            videoDurationMs: state.transition.videoDurationMs,
            overlayDurationMs: state.transition.overlayDurationMs,
            mouseDurationMs: state.transition.mouseDurationMs,
          },
    }
    console.log(
      `[merge-page] runTask transition (state.enabled=${state.transition.enabled}):`,
      JSON.stringify(body.transition),
    )
    try {
      const { jobId, renderId } = await startMergeJob(body)
      insertOptimistic(renderId, jobId, brand, '/api/merge-export', body)
    } catch {
      // The user has no row to retry — surface an inline error via a transient
      // failed entry would require a fake id. Rely on the modal-level UX.
    }
  }

  async function runProductOnlyTask(
    state: MergeFormState,
    productRecordingId: string,
    merchantBrand: { websiteUrl: string; brandName: string },
  ) {
    const merchantLabelText = merchantBrand.brandName || merchantBrand.websiteUrl
    const productLabelText = productLabel(productRecordingId)
    const brand = `${merchantLabelText}-${productLabelText}`
    const productSettings = sectionSettingsForApi(state.product)
    const body = { productRecordingId, merchantBrand, productSettings }
    try {
      const result = await startProductOnlyJob(body)
      if ('cached' in result && result.cached) {
        // Cache hit — server inserted a 'done' row directly. Refresh.
        fetchRenders()
        return
      }
      const { jobId, renderId } = result
      insertOptimistic(renderId, jobId, brand, '/api/product-only-export', body)
    } catch {
      /* see runTask comment */
    }
  }

  // Strip recording-id fields and shape the section settings so they can be
  // safely round-tripped through the retry path.
  function sectionSettingsForApi(section: MergeFormState['intro'] | MergeFormState['product']) {
    return {
      modeSource: section.modeSource,
      customMode: section.customMode,
      positionSource: section.positionSource,
      customPosition: section.customPosition,
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

  function openRenderEdit(renderId: string, jobRequest: JobRequest | null | undefined) {
    const initialState = bodyToFormState(jobRequest)
    if (!initialState) return
    setPreviewTarget(null)
    setEditingRender({ renderId, initialState })
  }

  // Edit submit: dispatch new job(s) first via the same path as a fresh
  // submit, then remove the old render. The DELETE is fire-and-forget — if
  // it fails the worker has already started so the user sees both rows
  // briefly; preferable to dropping the old row before the new job is
  // safely queued.
  function handleEditSubmit(state: MergeFormState) {
    if (!editingRender) return
    const oldId = editingRender.renderId
    handleGenerate(state)
    setRenders((prev) => prev.filter((r) => r.id !== oldId))
    fetch('/api/renders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: oldId }),
    }).catch(() => { /* swallow — UI already removed the row */ })
    setEditingRender(null)
  }

  function handleGenerate(state: MergeFormState) {
    // p1 (intro+product) and the custom flow with both sections enabled share
    // the same merge-export dispatch path. p2 (product-only) and custom with
    // intro disabled fan out via product-only-export. Custom with only intro
    // enabled hits merge-export with productEnabled=false (intro-only flow).
    const wantsBoth = state.intro.enabled && state.product.enabled
    const introOnly = state.intro.enabled && !state.product.enabled
    const productOnlyFlow =
      !state.intro.enabled && state.product.enabled

    if (wantsBoth) {
      const prodId = state.product.productRecordingId
      for (const merchantId of state.intro.merchantRecordingIds) {
        runTask(state, merchantId, prodId)
      }
    } else if (introOnly) {
      // Intro-only: one merge-export per selected merchant intro, no product.
      for (const merchantId of state.intro.merchantRecordingIds) {
        runTask(state, merchantId, null)
      }
    } else if (productOnlyFlow) {
      const prodId = state.product.productRecordingId
      // Only dispatch DB-matched merchants whose scrape is complete. Pending /
      // incomplete scrapes and free-text URL chips need a finished scrape
      // first, so they're held back and surfaced via the chip's tooltip action.
      for (const chip of state.product.brandMerchants) {
        if (chip.kind === 'merchant' && chip.status === 'complete') {
          runProductOnlyTask(state, prodId, { websiteUrl: chip.websiteUrl, brandName: chip.brandName })
        }
      }
    }
    setShowGenerateModal(false)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background p-[5vh] font-sans">
      <div className="relative h-full w-full">
        <div className={`absolute inset-0 flex gap-[10px] ${isPortrait ? 'flex-col' : 'flex-row'}`}>
            {/* Column A — Merchant Recordings */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">
                    Merchant Intros
                  </h2>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="About merchant intros"
                      className="peer flex items-center justify-center text-muted transition-colors hover:text-foreground"
                    >
                      <InfoCircleIcon width={16} height={16} />
                    </button>
                    <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-lg opacity-0 transition-opacity duration-100 peer-hover:opacity-100">
                      Create an intro personalized to your target merchant.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/merchant-flow')}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-80"
                >
                  Record
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
                        : 'text-foreground hover:bg-background'
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
                        <ExternalLinkIcon width={14} height={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (e.shiftKey) performDelete(r.id, 'recording')
                          else setDeleteTarget({ id: r.id, name: r.name ?? r.merchant_id ?? r.id.slice(0, 8), kind: 'recording' })
                        }}
                        className="text-muted hover:text-red-500"
                        title="Delete (shift+click to skip confirmation)"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </span>
                  </div>
                ))}
                {merchants.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">you do not have any merchant intros yet</p>
                )}
              </div>
            </div>

            {/* Column B — Product Recordings */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">
                    Product Recordings
                  </h2>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="About product recordings"
                      className="peer flex items-center justify-center text-muted transition-colors hover:text-foreground"
                    >
                      <InfoCircleIcon width={16} height={16} />
                    </button>
                    <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-lg opacity-0 transition-opacity duration-100 peer-hover:opacity-100">
                      Create a reusable product demo and preview merchant customizations.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/product-flow')}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-80"
                >
                  Record
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
                        : 'text-foreground hover:bg-background'
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
                        <ExternalLinkIcon width={14} height={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (e.shiftKey) performDelete(r.id, 'recording')
                          else setDeleteTarget({ id: r.id, name: r.name ?? r.product_name ?? r.id.slice(0, 8), kind: 'recording' })
                        }}
                        className="text-muted hover:text-red-500"
                        title="Delete (shift+click to skip confirmation)"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </span>
                  </div>
                ))}
                {products.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">you do not have any product recordings yet</p>
                )}
              </div>
            </div>

            {/* Column C — Renders */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">
                    Rendering Tasks
                  </h2>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="About rendering tasks"
                      className="peer flex items-center justify-center text-muted transition-colors hover:text-foreground"
                    >
                      <InfoCircleIcon width={16} height={16} />
                    </button>
                    <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-lg opacity-0 transition-opacity duration-100 peer-hover:opacity-100">
                      Join recordings into final rendered videos ready to share.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(true)}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-80"
                >
                  Render
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {renders.length === 0 && (
                  <p className="px-4 py-3 text-xs text-muted opacity-70">you do not have any rendering tasks yet</p>
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
                    setPreviewTarget({ kind: 'render', title: label, videoUrl: r.video_url, renderId: r.id, downloadName: label, slug: r.slug, jobRequest: r.job_request })
                  }

                  return (
                    <div
                      key={r.id}
                      className="group relative flex h-10 items-center justify-between border-b border-border px-4 transition-colors hover:bg-background"
                      onDoubleClick={openPreview}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />}
                        <p className="min-w-0 truncate text-sm text-foreground">{label}</p>
                      </span>

                      {r.status === 'error' ? (
                        <span className="ml-3 flex shrink-0 items-center gap-2">
                          <span className="text-xs text-red-500">Failed</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); retry(r) }}
                            className="text-muted hover:text-foreground"
                            title="Retry"
                          >
                            <RetryIcon width={14} height={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (e.shiftKey) performDelete(r.id, 'render')
                              else setDeleteTarget({ id: r.id, name: label, kind: 'render' })
                            }}
                            className="text-muted hover:text-red-500"
                            title="Delete (shift+click to skip confirmation)"
                          >
                            <TrashIcon width={14} height={14} />
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
                              <ExternalLinkIcon width={14} height={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (e.shiftKey) performDelete(r.id, 'render')
                                else setDeleteTarget({ id: r.id, name: label, kind: 'render' })
                              }}
                              className="text-muted hover:text-red-500"
                              title="Delete (shift+click to skip confirmation)"
                            >
                              <TrashIcon width={14} height={14} />
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

      {previewTarget?.kind === 'recording' && (
        <RecordingPreviewModal
          title={previewTarget.title}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.downloadName}
          trimStartSec={previewTarget.trimStartSec}
          trimEndSec={previewTarget.trimEndSec}
          onClose={() => setPreviewTarget(null)}
          onEdit={previewTarget.onEdit}
        />
      )}

      {previewTarget?.kind === 'render' && (
        <RenderPreviewModal
          title={previewTarget.title}
          videoUrl={previewTarget.videoUrl}
          downloadName={previewTarget.downloadName}
          trimStartSec={previewTarget.trimStartSec}
          trimEndSec={previewTarget.trimEndSec}
          slug={previewTarget.slug}
          jobRequest={previewTarget.jobRequest}
          onClose={() => setPreviewTarget(null)}
          onEdit={() => openRenderEdit(previewTarget.renderId, previewTarget.jobRequest)}
          onDelete={() => {
            setDeleteTarget({ id: previewTarget.renderId, name: previewTarget.title, kind: 'render' })
            setPreviewTarget(null)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {(showGenerateModal || editingRender) && (
        <GenerateMergeModal
          merchants={merchants.map((r) => ({ id: r.id, label: r.name ?? r.id.slice(0, 8) }))}
          products={products.map((r) => ({ id: r.id, label: r.name ?? r.id.slice(0, 8) }))}
          onClose={() => { setShowGenerateModal(false); setEditingRender(null) }}
          onSubmit={editingRender ? handleEditSubmit : handleGenerate}
          initialState={editingRender?.initialState}
          submitLabel={editingRender ? 'Re-render' : undefined}
          modalTitle={editingRender ? 'Edit & re-render' : undefined}
        />
      )}
    </div>
  )
}
