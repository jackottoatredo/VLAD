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
    <div className="relative w-full aspect-video rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden">

      {showError && (
        <div className="flex h-full w-full items-center justify-center p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {showLoading && loading && (
        <div className="flex h-full w-full flex-col items-center justify-end gap-3 px-8 pb-6">
          {loading.stages.map((stage) => (
            <div key={stage.label} className="w-full space-y-1">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>{stage.label}</span>
                <span>{Math.round(stage.progress)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-zinc-100"
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
          <p className="text-sm text-zinc-500">{emptyMessage}</p>
          {emptyAction && (
            <button
              onClick={emptyAction.onClick}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {emptyAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
