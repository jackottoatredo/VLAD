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

export function initialSteps(): PipelineStep[] {
  return STEP_LABELS.map((label) => ({ label, progress: 0 }))
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
