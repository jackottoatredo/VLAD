export type PipelineStep = {
  label: string
  progress: number
}

export const STEP_LABELS = [
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

export function initialSteps(): PipelineStep[] {
  return STEP_LABELS.map((label) => ({ label, progress: 0 }))
}

export function initialProductOnlySteps(): PipelineStep[] {
  return PRODUCT_ONLY_STEP_LABELS.map((label) => ({ label, progress: 0 }))
}

type MergeJobResponse = {
  status: 'running' | 'done' | 'error'
  currentStep: number
  stepProgress: number[]
  stepLabels: string[]
  videoUrl?: string
  renderId?: string
  error?: string
}

/**
 * Start a merge-export job on the server and poll for progress.
 *
 * Calls `onProgress` with updated step progress on each poll tick.
 * Returns the final job state when complete.
 */
export async function runMergeJob(
  merchantRecordingId: string,
  productRecordingId: string,
  brand: string,
  onProgress: (steps: PipelineStep[]) => void,
): Promise<{ renderId: string; videoUrl: string }> {
  const res = await fetch('/api/merge-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantRecordingId, productRecordingId, brand }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to start merge job.')
  }

  const { jobId } = (await res.json()) as { jobId: string }

  // Poll for progress
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/merge-export?jobId=${jobId}`)
        if (!r.ok) {
          reject(new Error('Failed to fetch job progress.'))
          return
        }

        const job = (await r.json()) as MergeJobResponse

        // Update progress
        const steps = STEP_LABELS.map((label, i) => ({
          label,
          progress: job.stepProgress[i] ?? 0,
        }))
        onProgress(steps)

        if (job.status === 'done') {
          resolve({
            renderId: job.renderId ?? '',
            videoUrl: job.videoUrl ?? '',
          })
          return
        }

        if (job.status === 'error') {
          reject(new Error(job.error ?? 'Merge failed.'))
          return
        }

        // Keep polling
        setTimeout(poll, 500)
      } catch (err) {
        reject(err)
      }
    }

    setTimeout(poll, 500)
  })
}

type ProduceProgressShape =
  | { status: 'rendering'; rendered?: number; total?: number }
  | { status: 'compositing'; composited?: number; total?: number }
  | { status: 'done'; videoUrl?: string; videoR2Key?: string; renderId?: string }
  | { status: 'error'; message?: string }
  | Record<string, unknown>

function progressFromProduce(p: ProduceProgressShape): PipelineStep[] {
  const steps = initialProductOnlySteps()
  const status = (p as { status?: string }).status
  if (status === 'rendering') {
    const rendered = Number((p as { rendered?: number }).rendered ?? 0)
    const total = Number((p as { total?: number }).total ?? 0)
    steps[0].progress = total > 0 ? Math.round((rendered / total) * 100) : 0
  } else if (status === 'compositing') {
    const composited = Number((p as { composited?: number }).composited ?? 0)
    const total = Number((p as { total?: number }).total ?? 0)
    steps[0].progress = 100
    steps[1].progress = total > 0 ? Math.round((composited / total) * 100) : 0
  } else if (status === 'done') {
    steps[0].progress = 100
    steps[1].progress = 100
    steps[2].progress = 100
  }
  return steps
}

/**
 * Start a product-only export job (one product recording + one merchant brand
 * → one render). Polls /api/render-progress per the produce job contract,
 * translating produce progress into the 3-step product-only display.
 */
export async function runProductOnlyJob(
  productRecordingId: string,
  merchantBrand: { websiteUrl: string; brandName: string },
  onProgress: (steps: PipelineStep[]) => void,
): Promise<{ renderId: string; videoR2Key: string }> {
  const res = await fetch('/api/product-only-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productRecordingId, merchantBrand }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to start product-only job.')
  }

  const start = (await res.json()) as
    | { cached: true; renderId: string; videoR2Key: string }
    | { jobId: string }

  if ('cached' in start && start.cached) {
    onProgress(progressFromProduce({ status: 'done' }))
    return { renderId: start.renderId, videoR2Key: start.videoR2Key }
  }

  const { jobId } = start as { jobId: string }
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/render-progress/${jobId}`)
        if (!r.ok) return reject(new Error('Failed to fetch job progress.'))
        const job = (await r.json()) as ProduceProgressShape
        onProgress(progressFromProduce(job))

        const status = (job as { status?: string }).status
        if (status === 'done') {
          const renderId = (job as { renderId?: string }).renderId
          const videoR2Key = (job as { videoR2Key?: string }).videoR2Key ?? ''
          if (!renderId) return reject(new Error('Worker did not return a render id.'))
          return resolve({ renderId, videoR2Key })
        }
        if (status === 'error') {
          return reject(new Error((job as { message?: string }).message ?? 'Render failed.'))
        }
        setTimeout(poll, 500)
      } catch (err) {
        reject(err)
      }
    }
    setTimeout(poll, 500)
  })
}
