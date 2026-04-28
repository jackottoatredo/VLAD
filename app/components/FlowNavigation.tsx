'use client'

type Props = {
  steps: string[]
  currentStep: number
  canGoForward: boolean
  onBack?: () => void
  onForward?: () => void
}

export default function FlowNavigation({ steps, currentStep, canGoForward, onBack, onForward }: Props) {
  const showBack = currentStep > 0
  const showForward = currentStep < steps.length - 1
  const backLabel = currentStep > 0 ? steps[currentStep - 1] : ''
  const forwardLabel = currentStep < steps.length - 1 ? steps[currentStep + 1] : ''

  return (
    <>
      {showBack && (
        <button
          onClick={onBack}
          className="fixed left-4 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition hover:bg-background">
            ←
          </div>
          <span className="text-xs text-muted">{backLabel}</span>
        </button>
      )}
      {showForward && (
        <button
          onClick={canGoForward ? onForward : undefined}
          disabled={!canGoForward}
          className="fixed right-4 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1"
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition ${
              canGoForward
                ? 'border-border bg-surface text-foreground hover:bg-background'
                : 'border-border bg-background text-muted opacity-60 cursor-not-allowed'
            }`}
          >
            →
          </div>
          <span className={`text-xs ${canGoForward ? 'text-muted' : 'text-muted opacity-60'}`}>{forwardLabel}</span>
        </button>
      )}
    </>
  )
}
