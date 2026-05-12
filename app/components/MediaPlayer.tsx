'use client'

type LoadingStage = {
  label: string
  progress: number
  /** Optional parallel sub-tasks rendered as nested mini-bars below the
   *  parent. Used by the v4 layered render step (Background / Overlay
   *  lanes) so the user can see what's happening in parallel. */
  subTasks?: { label: string; progress: number }[]
}

type MediaPlayerProps = {
  videoUrl?: string | null
  videoRef?: React.RefObject<HTMLVideoElement | null>
  emptyMessage?: string
  emptyAction?: { label: string; onClick: () => void }
  loading?: { stages: LoadingStage[] }
  error?: string | null
  errorAction?: { label: string; onClick: () => void }
}

export type { MediaPlayerProps }

export default function MediaPlayer({
  videoUrl,
  videoRef,
  emptyMessage = 'No media',
  emptyAction,
  loading,
  error,
  errorAction,
}: MediaPlayerProps) {
  // State priority: error > loading > videoUrl > empty
  const showError = !!error
  const showLoading = !showError && !!loading
  const showVideo = !showError && !showLoading && !!videoUrl
  const showEmpty = !showError && !showLoading && !showVideo

  return (
    <div className="relative w-full aspect-video rounded-lg bg-background overflow-hidden">

      {showError && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm text-red-500">{error}</p>
          {errorAction && (
            <button
              onClick={errorAction.onClick}
              className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black shadow-sm hover:opacity-80"
            >
              {errorAction.label}
            </button>
          )}
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
              {stage.subTasks && stage.subTasks.length > 0 && (
                <div className="ml-3 mt-1 space-y-1">
                  {stage.subTasks.map((sub) => (
                    <div key={sub.label} className="space-y-0.5">
                      <div className="flex justify-between text-[10px] text-muted opacity-80">
                        <span>{sub.label}</span>
                        <span>{Math.round(sub.progress)}%</span>
                      </div>
                      <div className="h-0.5 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-foreground/70 transition-all duration-500"
                          style={{ width: `${Math.round(sub.progress)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-80"
            >
              {emptyAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
