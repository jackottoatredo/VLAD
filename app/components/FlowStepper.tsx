'use client'

export type StepState = 'current' | 'complete' | 'incomplete' | 'locked'

type Props = {
  steps: string[]
  stepStates: StepState[]
  onStepClick?: (step: number) => void
}

export default function FlowStepper({ steps, stepStates, onStepClick }: Props) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-4">
      {steps.map((label, i) => {
        const state = stepStates[i] ?? 'locked'
        const isCurrent = state === 'current'
        const isComplete = state === 'complete'
        const isIncomplete = state === 'incomplete'
        const isLocked = state === 'locked'
        const canClick = !!onStepClick && !isLocked

        const circleCls = isCurrent
          ? 'bg-accent text-white ring-2 ring-accent/30'
          : isComplete
          ? 'bg-accent text-white'
          : isIncomplete
          ? 'border border-border bg-surface text-foreground'
          : 'bg-border text-muted opacity-60'

        const labelCls = isCurrent
          ? 'font-medium text-foreground'
          : isComplete
          ? 'text-foreground'
          : isIncomplete
          ? 'text-muted'
          : 'text-muted opacity-60'

        const prevLocked = i > 0 && stepStates[i - 1] === 'locked'
        const connectorCls = i > 0 && !prevLocked && !isLocked ? 'bg-accent' : 'bg-border'

        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className={`h-px w-6 ${connectorCls}`} />}
            <button
              type="button"
              onClick={() => canClick && onStepClick?.(i)}
              disabled={!canClick}
              className={`flex items-center gap-1.5 ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${circleCls}`}>
                {isComplete ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${labelCls}`}>{label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
