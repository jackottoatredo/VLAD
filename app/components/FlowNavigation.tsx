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
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800">
            ←
          </div>
          <span className="text-xs text-zinc-500">{backLabel}</span>
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
                ? 'border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800'
                : 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600'
            }`}
          >
            →
          </div>
          <span className={`text-xs ${canGoForward ? 'text-zinc-500' : 'text-zinc-400 dark:text-zinc-600'}`}>{forwardLabel}</span>
        </button>
      )}
    </>
  )
}
