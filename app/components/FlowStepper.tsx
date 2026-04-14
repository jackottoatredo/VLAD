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
              <div className={`h-px w-6 ${i <= maxReachable ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
            )}
            <button
              type="button"
              onClick={() => canClick && onStepClick?.(i)}
              disabled={!canClick}
              className={`flex items-center gap-1.5 ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isActive
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : isDone
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : isFuture
                    ? 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600'
                    : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs ${
                  isActive ? 'font-medium text-zinc-900 dark:text-zinc-100'
                  : isFuture ? 'text-zinc-400 dark:text-zinc-600'
                  : 'text-zinc-500'
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
