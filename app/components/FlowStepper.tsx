'use client'

type Props = {
  steps: string[]
  currentStep: number
  maxReachableStep?: number
  onStepClick?: (step: number) => void
}

export default function FlowStepper({ steps, currentStep, maxReachableStep, onStepClick }: Props) {
  const maxReachable = maxReachableStep ?? currentStep

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-4">
      {steps.map((label, i) => {
        const isActive = i === currentStep
        const isDone = i < currentStep
        const canClick = !!onStepClick && i <= maxReachable
        const isFuture = i > maxReachable

        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`h-px w-6 ${i <= maxReachable ? 'bg-accent' : 'bg-border'}`} />
            )}
            <button
              type="button"
              onClick={() => canClick && onStepClick?.(i)}
              disabled={!canClick}
              className={`flex items-center gap-1.5 ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isActive || isDone
                    ? 'bg-accent text-white'
                    : isFuture
                    ? 'bg-border text-muted opacity-60'
                    : 'bg-border text-muted'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs ${
                  isActive ? 'font-medium text-foreground'
                  : isFuture ? 'text-muted opacity-60'
                  : 'text-muted'
                }`}
              >
                {label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
