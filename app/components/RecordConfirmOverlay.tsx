'use client'

type Props = {
  uploadStatus: 'idle' | 'uploading' | 'ready'
  onRecordAgain: () => void
  onContinue: () => void
  continueDisabled?: boolean
  continueLabel?: string
}

export default function RecordConfirmOverlay({
  uploadStatus,
  onRecordAgain,
  onContinue,
  continueDisabled,
  continueLabel = 'Continue to Post',
}: Props) {
  if (uploadStatus === 'idle') return null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-8 py-6 shadow-md">
        {uploadStatus === 'uploading' ? (
          <>
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <p className="text-sm font-medium text-foreground">Finishing upload…</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">Happy with this take?</p>
            <div className="flex gap-2">
              <button
                onClick={onRecordAgain}
                className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-background"
              >
                Record Again
              </button>
              <button
                onClick={onContinue}
                disabled={continueDisabled}
                className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background shadow-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {continueLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
