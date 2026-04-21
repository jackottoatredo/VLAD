'use client'

type LoadingStage = { label: string; progress: number }

type MediaPlayerProps = {
  videoUrl?: string | null
  videoRef?: React.RefObject<HTMLVideoElement | null>
  emptyMessage?: string
  emptyAction?: { label: string; onClick: () => void }
  loading?: { stages: LoadingStage[] }
  error?: string | null
}

export type { MediaPlayerProps }

export default function MediaPlayer({
  videoUrl,
  videoRef,
  emptyMessage = 'No media',
  emptyAction,
  loading,
  error,
}: MediaPlayerProps) {
  // State priority: error > loading > videoUrl > empty
  const showError = !!error
  const showLoading = !showError && !!loading
  const showVideo = !showError && !showLoading && !!videoUrl
  const showEmpty = !showError && !showLoading && !showVideo

  return (
    <div className="relative w-full aspect-video rounded-lg bg-background overflow-hidden">

      {showError && (
        <div className="flex h-full w-full items-center justify-center p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {showLoading && loading && (
        <div className="flex h-full w-full flex-col items-center justify-end gap-3 px-8 pb-6">
          {loading.stages.map((stage) => (
            <div key={stage.label} className="w-full space-y-1">
              <div className="flex justify-between text-xs text-muted">
                <span>{stage.label}</span>
                <span>{Math.round(stage.progress)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-foreground transition-all duration-500"
                  style={{ width: `${Math.round(stage.progress)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {showVideo && (
        <video ref={videoRef} src={videoUrl!} controls className="h-full w-full object-contain" />
      )}

      {showEmpty && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted">{emptyMessage}</p>
          {emptyAction && (
            <button
              onClick={emptyAction.onClick}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background shadow-sm hover:opacity-80"
            >
              {emptyAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
