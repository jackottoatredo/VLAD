import type { JobProgress, JobStep } from '@/lib/queue/progress'

export type PipelineStep = JobStep

const POLL_MS = 500

export const MERGE_STEP_LABELS = [
  'Rendering intro',
  'Compositing intro',
  'Rendering product',
  'Compositing product',
  'Merging',
]

export const PRODUCT_ONLY_STEP_LABELS = [
  'Rendering',
  'Compositing',
  'Clipping',
]

export function initialMergeSteps(): PipelineStep[] {
  return MERGE_STEP_LABELS.map((label) => ({ label, progress: 0 }))
}

export function initialProductOnlySteps(): PipelineStep[] {
  return PRODUCT_ONLY_STEP_LABELS.map((label) => ({ label, progress: 0 }))
}

/**
 * Thrown by pollJob when /api/jobs/:jobId returns 404 — the BullMQ job is gone
 * (worker crashed, Redis evicted, or the id is stale). Callers catch this to
 * PATCH the corresponding vlad_renders row to status='error'.
 */
export class JobMissingError extends Error {
  constructor(public jobId: string) {
    super(`Job ${jobId} not found.`)
    this.name = 'JobMissingError'
  }
}

export type PollResult = {
  renderId?: string
  videoUrl?: string
  videoR2Key?: string
}

/**
 * Polls /api/jobs/:jobId until the job reaches a terminal state. Calls
 * onProgress on each running tick with the steps array emitted by the worker
 * (count and labels are owned by the job, not the polling layer).
 *
 * Resolves with renderId/videoUrl on done, throws JobMissingError on 404,
 * throws Error on status='error'.
 */
export function pollJob(
  jobId: string,
  onProgress: (steps: PipelineStep[], currentStep: number) => void,
): Promise<PollResult> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        if (res.status === 404) {
          reject(new JobMissingError(jobId))
          return
        }
        if (!res.ok) {
          // Transient — try again on next tick.
          setTimeout(tick, POLL_MS)
          return
        }
        const job = (await res.json()) as JobProgress

        if (job.status === 'running') {
          onProgress(job.steps, job.currentStep)
          setTimeout(tick, POLL_MS)
          return
        }

        if (job.status === 'queued') {
          setTimeout(tick, POLL_MS)
          return
        }

        if (job.status === 'done') {
          resolve({
            renderId: job.renderId,
            videoUrl: job.videoUrl,
            videoR2Key: job.videoR2Key,
          })
          return
        }

        if (job.status === 'error') {
          reject(new Error(job.message ?? 'Render failed.'))
          return
        }

        // Unknown status — retry
        setTimeout(tick, POLL_MS)
      } catch (err) {
        reject(err)
      }
    }

    setTimeout(tick, POLL_MS)
  })
}

/**
 * POST /api/merge-export to stub a vlad_renders row and enqueue the merge job.
 * The DB row exists with status='rendering' before this returns, so a refresh
 * mid-render reveals the in-progress task on next mount.
 *
 * Body is forwarded as-is so the retry path can replay the exact request that
 * created the original render.
 */
export async function startMergeJob(
  body: Record<string, unknown>,
): Promise<{ jobId: string; renderId: string }> {
  const res = await fetch('/api/merge-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to start merge job.')
  }
  return (await res.json()) as { jobId: string; renderId: string }
}

/**
 * POST /api/product-only-export. Same stub-then-enqueue contract as
 * startMergeJob, except a fully-cached render returns { cached: true,
 * renderId, videoR2Key } and skips the job entirely.
 */
export async function startProductOnlyJob(
  body: Record<string, unknown>,
): Promise<
  | { cached: true; renderId: string; videoR2Key: string }
  | { cached?: false; jobId: string; renderId: string }
> {
  const res = await fetch('/api/product-only-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to start product-only job.')
  }
  return (await res.json()) as
    | { cached: true; renderId: string; videoR2Key: string }
    | { cached?: false; jobId: string; renderId: string }
}
