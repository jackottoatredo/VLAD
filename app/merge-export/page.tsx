'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/app/components/Modal'
import DeleteModal from '@/app/components/DeleteModal'
import MultiSelect from '@/app/components/MultiSelect'
import { buildPipeline } from './pipeline'

type Recording = {
  id: string
  type: 'product' | 'merchant'
  product_name: string | null
  merchant_id: string | null
  created_at: string
}

type Render = {
  id: string
  brand: string | null
  video_url: string | null
  status: 'pending' | 'rendering' | 'done' | 'error'
  progress: number
  seen: boolean
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
  const [merchants, setMerchants] = useState<Recording[]>([])
  const [products, setProducts] = useState<Recording[]>([])
  const [renders, setRenders] = useState<Render[]>([])

  const [selectedMerchants, setSelectedMerchants] = useState<Set<string>>(new Set())
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [modalMerchants, setModalMerchants] = useState<Set<string>>(new Set())
  const [modalProduct, setModalProduct] = useState('')
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: 'recording' | 'render' } | null>(null)

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
    return merchants.find((m) => m.id === id)?.merchant_id ?? id.slice(0, 8)
  }

  function productLabel(id: string) {
    return products.find((p) => p.id === id)?.product_name ?? id.slice(0, 8)
  }

  async function runTask(merchantRecordingId: string, productRecordingId: string) {
    const brand = `${merchantLabel(merchantRecordingId)}-${productLabel(productRecordingId)}`
    const pipeline = buildPipeline()
    const key = `${merchantRecordingId}-${productRecordingId}-${Date.now()}`

    const task: ActiveTask = {
      key,
      brand,
      merchantRecordingId,
      productRecordingId,
      steps: pipeline.map((s) => ({ label: s.label, progress: 0 })),
    }

    setActiveTasks((prev) => [...prev, task])

    try {
      for (let i = 0; i < pipeline.length; i++) {
        await pipeline[i].run((pct) => {
          setActiveTasks((prev) =>
            prev.map((t) => {
              if (t.key !== key) return t
              const steps = [...t.steps]
              steps[i] = { ...steps[i], progress: pct }
              return { ...t, steps }
            })
          )
        })
      }

      // Save to database
      const res = await fetch('/api/renders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantRecordingId, productRecordingId, brand }),
      })
      const { render } = await res.json() as { render: Render }

      // Stash the DB id so the unified list can swap the active entry for the DB row
      setActiveTasks((prev) => prev.map((t) => (t.key === key ? { ...t, renderId: render.id } : t)))
      setRenders((prev) => [render, ...prev])
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
    <div className="flex min-h-screen w-full items-center justify-center bg-black font-sans" style={{ padding: '0 150px' }}>
      <div className="relative w-full" style={{ aspectRatio: '15/8' }}>
        <div className="absolute inset-0 flex gap-[10px]">
            {/* Column A — Merchant Recordings */}
            <div className="flex w-1/3 flex-col overflow-hidden rounded-xl border border-zinc-700">
              <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Merchant Intros
                </h2>
                <Link
                  href="/merchant-flow"
                  className="flex h-5 w-5 items-center justify-center rounded border border-zinc-600 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
                >
                  <span className="text-sm leading-none">+</span>
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto">
                {merchants.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => toggleMerchant(r.id)}
                    className={`group flex h-10 w-full cursor-pointer items-center justify-between border-b border-zinc-800 px-4 text-sm transition-colors ${
                      selectedMerchants.has(r.id)
                        ? 'bg-zinc-800 text-zinc-50'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <span className="min-w-0 truncate">{r.merchant_id ?? r.id.slice(0, 8)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: r.merchant_id ?? r.id.slice(0, 8), kind: 'recording' }) }}
                      className="ml-2 shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                ))}
                {merchants.length === 0 && (
                  <p className="px-4 py-3 text-xs text-zinc-600">No merchant recordings yet.</p>
                )}
              </div>
            </div>

            {/* Column B — Product Recordings */}
            <div className="flex w-1/3 flex-col overflow-hidden rounded-xl border border-zinc-700">
              <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Product Recordings
                </h2>
                <Link
                  href="/product-flow"
                  className="flex h-5 w-5 items-center justify-center rounded border border-zinc-600 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
                >
                  <span className="text-sm leading-none">+</span>
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto">
                {products.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedProduct(r.id === selectedProduct ? null : r.id)}
                    className={`group flex h-10 w-full cursor-pointer items-center justify-between border-b border-zinc-800 px-4 text-sm transition-colors ${
                      selectedProduct === r.id
                        ? 'bg-zinc-800 text-zinc-50'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    <span className="min-w-0 truncate">{r.product_name ?? r.id.slice(0, 8)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: r.product_name ?? r.id.slice(0, 8), kind: 'recording' }) }}
                      className="ml-2 shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                ))}
                {products.length === 0 && (
                  <p className="px-4 py-3 text-xs text-zinc-600">No product recordings yet.</p>
                )}
              </div>
            </div>

            {/* Column C — Renders */}
            <div className="flex w-1/3 flex-col overflow-hidden rounded-xl border border-zinc-700">
              <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Exports
                </h2>
                <button
                  onClick={() => setShowGenerateModal(true)}
                  className="flex h-5 w-5 items-center justify-center rounded border border-zinc-600 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
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
                    return <p className="px-4 py-3 text-xs text-zinc-600">No exports yet.</p>
                  }

                  return entries.map((entry, i) => {
                    const border = ' border-b border-zinc-800'

                    if (entry.kind === 'active') {
                      const { task } = entry
                      const currentStep = task.renderId
                        ? null
                        : task.steps.find((s) => s.progress < 100) ?? task.steps[task.steps.length - 1]
                      const isNew = task.renderId && !task.markedSeen

                      return (
                        <div
                          key={task.key}
                          className={`group relative flex h-10 items-center justify-between px-4 transition-colors hover:bg-zinc-900${border}${isNew ? ' cursor-pointer' : ''}`}
                          onClick={isNew ? () => markSeen(task.renderId!) : undefined}
                        >
                          <p className="min-w-0 truncate text-sm text-zinc-400">{task.brand}</p>
                          <span className="ml-3 flex shrink-0 items-center gap-2">
                            {task.error ? (
                              <span className="text-xs text-red-500">{task.error}</span>
                            ) : currentStep ? (
                              <span className="text-xs text-zinc-600">{currentStep.label}</span>
                            ) : isNew ? (
                              <span className="text-xs text-zinc-500">new</span>
                            ) : null}
                            {task.renderId && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: task.renderId!, name: task.brand, kind: 'render' }) }}
                                className="text-zinc-600 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                              </button>
                            )}
                          </span>
                          {!task.renderId && !task.error && (
                            <div className="absolute bottom-0 left-0 right-0 flex h-[2px] gap-[2px]">
                              {task.steps.map((step) => (
                                <div key={step.label} className="flex-1 bg-zinc-800">
                                  <div
                                    className="h-full bg-zinc-400 transition-all duration-100"
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
                    return (
                      <div
                        key={r.id}
                        className={`group flex h-10 items-center justify-between px-4 transition-colors hover:bg-zinc-900${border}${isNew ? ' cursor-pointer' : ''}`}
                        onClick={isNew ? () => markSeen(r.id) : undefined}
                      >
                        <p className="min-w-0 truncate text-sm text-zinc-400">{r.brand ?? r.id.slice(0, 8)}</p>
                        <span className="ml-3 flex shrink-0 items-center gap-2">
                          {isNew && <span className="text-xs text-zinc-500">new</span>}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: r.id, name: r.brand ?? r.id.slice(0, 8), kind: 'render' }) }}
                            className="text-zinc-600 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
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
              <label className="mb-1 block text-xs font-medium text-zinc-400">Merchant Intros</label>
              <MultiSelect
                options={merchants.map((r) => ({ value: r.id, label: r.merchant_id ?? r.id.slice(0, 8) }))}
                selected={modalMerchants}
                onChange={setModalMerchants}
                placeholder="Select merchant intros"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Product Recording</label>
              <select
                value={modalProduct}
                onChange={(e) => setModalProduct(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
              >
                <option value="">Select a product recording</option>
                {products.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.product_name ?? r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={modalMerchants.size === 0 || !modalProduct}
              className="w-full rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start {modalMerchants.size || 0} rendering task{modalMerchants.size === 1 ? '' : 's'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
