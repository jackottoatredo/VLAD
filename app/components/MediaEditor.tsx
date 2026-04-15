'use client'

import MediaPlayer, { type MediaPlayerProps } from '@/app/components/MediaPlayer'
import VideoTrimmer from '@/app/components/VideoTrimmer'

type MediaEditorProps = MediaPlayerProps & {
  fps?: number
  onTrimChange?: (startSec: number, endSec: number) => void
  initialTrimStart?: number
  initialTrimEnd?: number
}

export type { MediaEditorProps }

export default function MediaEditor({
  fps = 30,
  onTrimChange,
  initialTrimStart,
  initialTrimEnd,
  ...playerProps
}: MediaEditorProps) {
  const { videoUrl, error, loading } = playerProps
  const isReady = !!videoUrl && !error && !loading

  if (isReady) {
    return (
      <VideoTrimmer
        videoUrl={videoUrl}
        fps={fps}
        onTrimChange={onTrimChange ?? (() => {})}
        initialTrimStart={initialTrimStart}
        initialTrimEnd={initialTrimEnd}
      />
    )
  }

  // Show loading/error/empty in the video area with disabled controls below
  return (
    <div className="flex flex-col gap-3">
      {/* Video area — same aspect ratio container with loading state inside */}
      <MediaPlayer {...playerProps} />

      {/* Disabled time display */}
      <div className="flex justify-between text-xs text-zinc-600 font-mono">
        <span>In: 0:00.0</span>
        <span>0:00.0</span>
        <span>Out: 0:00.0</span>
      </div>

      {/* Disabled timeline track */}
      <div className="relative h-6 w-full select-none">
        <div className="absolute inset-x-0 top-[10px] h-[2px] bg-zinc-700" />
        <div
          className="absolute top-[3px] h-4 w-3 -ml-1.5 rounded-sm border border-zinc-600 bg-zinc-800"
          style={{ left: '0%' }}
        />
        <div
          className="absolute top-[3px] h-4 w-3 -ml-1.5 rounded-sm border border-zinc-600 bg-zinc-800"
          style={{ left: '100%' }}
        />
        <div
          className="absolute top-[6px] h-[10px] w-[10px] -ml-[5px] rounded-full bg-zinc-600"
          style={{ left: '0%' }}
        />
      </div>

      {/* Disabled transport controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          disabled
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-700 cursor-not-allowed"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="1" y="2" width="2" height="10" />
            <path d="M12 2 L5 7 L12 12 Z" />
          </svg>
        </button>
        <button
          disabled
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 text-zinc-600 cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2 0 L12 6 L2 12 Z" />
          </svg>
        </button>
        <button
          disabled
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-700 cursor-not-allowed"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2 2 L9 7 L2 12 Z" />
            <rect x="11" y="2" width="2" height="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
