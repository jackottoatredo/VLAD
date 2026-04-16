export type PipelineStep = {
  label: string
  run: (onProgress: (pct: number) => void) => Promise<void>
}

/** Stub: simulate a 1-second task with smooth progress. Replace with real implementation later. */
function stubStep(label: string): PipelineStep {
  return {
    label,
    run: (onProgress) =>
      new Promise<void>((resolve) => {
        const duration = 1000
        const interval = 50
        let elapsed = 0
        const timer = setInterval(() => {
          elapsed += interval
          onProgress(Math.min(100, (elapsed / duration) * 100))
          if (elapsed >= duration) {
            clearInterval(timer)
            resolve()
          }
        }, interval)
      }),
  }
}

export function buildPipeline(): PipelineStep[] {
  return [
    stubStep('Rendering intro'),
    stubStep('Compositing intro'),
    stubStep('Rendering product'),
    stubStep('Compositing product'),
    stubStep('Merging'),
  ]
}
