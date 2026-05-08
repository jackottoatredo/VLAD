'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import type { RenderLogResponse } from '@/app/api/renders/[id]/log/route'

type Props = {
  renderId: string
  title: string
  onClose: () => void
}

type Tab = 'failure' | 'stacktrace' | 'logs'

export default function RenderLogModal({ renderId, title, onClose }: Props) {
  const [data, setData] = useState<RenderLogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/renders/${renderId}/log`)
      .then(async (res) => {
        const body = (await res.json()) as RenderLogResponse | { error: string }
        if (cancelled) return
        if (!res.ok) {
          setError('error' in body ? body.error : 'Failed to load log.')
        } else {
          setData(body as RenderLogResponse)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load log.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [renderId])

  // Pick the most relevant tab as the default once data arrives. Failure-first
  // for errored jobs, stacktrace if there's no message but trace exists,
  // otherwise logs (the success-render case).
  const defaultTab: Tab = useMemo(() => {
    if (!data) return 'failure'
    if (data.failedReason) return 'failure'
    if (data.stacktrace.length > 0) return 'stacktrace'
    return 'logs'
  }, [data])

  const tab = activeTab ?? defaultTab

  return (
    <Modal title={`Render log — ${title}`} size="lg" onClose={onClose}>
      {loading && <div className="text-sm text-muted">Loading…</div>}
      {error && <div className="text-sm text-red-500">{error}</div>}
      {!loading && !error && data && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span>job: <span className="font-mono text-foreground">{data.jobId ?? '—'}</span></span>
            <span>status: <span className="font-mono text-foreground">{data.status ?? '—'}</span></span>
            {data.attemptsMade != null && (
              <span>attempts: <span className="font-mono text-foreground">{data.attemptsMade}</span></span>
            )}
          </div>

          {data.jobMissingReason && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {data.jobMissingReason}
            </div>
          )}

          <div className="flex border-b border-border text-xs">
            <TabButton
              active={tab === 'failure'}
              onClick={() => setActiveTab('failure')}
              label="Failure"
            />
            <TabButton
              active={tab === 'stacktrace'}
              onClick={() => setActiveTab('stacktrace')}
              label={`Stack trace${data.stacktrace.length > 0 ? ` (${data.stacktrace.length})` : ''}`}
            />
            <TabButton
              active={tab === 'logs'}
              onClick={() => setActiveTab('logs')}
              label={`Job log${data.logs.length > 0 ? ` (${data.logs.length})` : ''}`}
            />
          </div>

          {tab === 'failure' && (
            data.failedReason ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                {data.failedReason}
              </pre>
            ) : (
              <EmptyState>No failure message.</EmptyState>
            )
          )}

          {tab === 'stacktrace' && (
            data.stacktrace.length > 0 ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                {data.stacktrace.join('\n\n')}
              </pre>
            ) : (
              <EmptyState>No stack trace.</EmptyState>
            )
          )}

          {tab === 'logs' && (
            data.logs.length > 0 ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                {data.logs.join('\n')}
              </pre>
            ) : (
              <EmptyState>No log entries.</EmptyState>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 transition-colors ${
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted">
      {children}
    </div>
  )
}
