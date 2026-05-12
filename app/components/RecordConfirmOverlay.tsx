'use client'

type Props = {
  uploadStatus: 'idle' | 'uploading' | 'ready'
  onRecordAgain: () => void
  durationMs?: number | null
}

export default function RecordConfirmOverlay({
  uploadStatus,
  onRecordAgain,
  durationMs,
}: Props) {
  // Only show the confirmation prompt. The 'uploading' state keeps the upload
  // running in the background (the caller awaits commit()) without showing any
  // UI — no spinner, no "Finishing upload" message. The RecordStep's controls
  // stay disabled via overlayVisible so the user can't interact mid-upload.
  if (uploadStatus !== 'ready') return null

  const seconds = durationMs != null ? (durationMs / 1000).toFixed(1) : null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-8 py-6 shadow-md">
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-semibold text-foreground">Recorded</p>
          {seconds != null && (
            <p className="text-xs text-muted">Duration: {seconds}s</p>
          )}
        </div>
        <button
          onClick={onRecordAgain}
          className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-background"
        >
          Record Again
        </button>
      </div>
    </div>
  )
}
