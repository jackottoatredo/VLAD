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
  // Only show the confirmation prompt. The 'uploading' state keeps the upload
  // running in the background (the caller awaits commit()) without showing any
  // UI — no spinner, no "Finishing upload" message. The RecordStep's controls
  // stay disabled via overlayVisible so the user can't interact mid-upload.
  if (uploadStatus !== 'ready') return null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-8 py-6 shadow-md">
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
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
