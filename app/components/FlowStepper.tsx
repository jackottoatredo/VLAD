'use client'

export type StepState = 'current' | 'complete' | 'incomplete' | 'locked'

type Props = {
  steps: string[]
  stepStates: StepState[]
}

// A small lock glyph overlaid on locked step circles.
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export default function FlowStepper({ steps, stepStates }: Props) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-4">
      {steps.map((label, i) => {
        const state = stepStates[i] ?? 'incomplete'
        const isCurrent = state === 'current'
        const isComplete = state === 'complete'
        const isIncomplete = state === 'incomplete'
        const isLocked = state === 'locked'

        const circleCls = isCurrent
          ? 'bg-accent text-white ring-2 ring-accent/30'
          : isComplete
          ? 'bg-accent text-white'
          : isLocked
          ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/40'
          : // incomplete (visited-no-outputs or future)
            'bg-border text-muted'

        const labelCls = isCurrent
          ? 'font-medium text-foreground'
          : isComplete
          ? 'text-foreground'
          : isLocked
          ? 'text-orange-600 dark:text-orange-400'
          : 'text-muted'

        // Connector: accent if both sides are "reached" (current/complete),
        // border otherwise. Locked never extends the accent line.
        const prev = stepStates[i - 1]
        const prevReached = prev === 'complete' || prev === 'current'
        const selfReached = isComplete || isCurrent
        const connectorCls = i > 0 && prevReached && (selfReached || isIncomplete) ? 'bg-accent' : 'bg-border'

        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className={`h-px w-6 ${connectorCls}`} />}
            <div className="flex items-center gap-1.5 cursor-default select-none">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${circleCls}`}>
                {isLocked ? <LockIcon /> : isComplete ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${labelCls}`}>{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
