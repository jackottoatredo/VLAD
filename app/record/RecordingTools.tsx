'use client'
import RecordingControlPanel from './RecordingControlPanel'
import SpeakerNotes from './SpeakerNotes'

type Props = {
  isRecording: boolean
  onStart: (sessionName: string, presenter: string) => void
  onStop: () => void
}

export default function RecordingTools({ isRecording, onStart, onStop }: Props) {
  return (
    <div className="flex w-full gap-[10px]">
      <div className="w-1/4">
        <RecordingControlPanel isRecording={isRecording} onStart={onStart} onStop={onStop} />
      </div>
      <div className="w-1/2">
        <SpeakerNotes />
      </div>
      <div className="flex w-1/4 flex-col justify-center gap-1 overflow-hidden rounded-xl border border-zinc-200 px-[1.5vw] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <p className="text-[1vw] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Tips</p>
        <p className="text-[1.1vw]">✓ Click continue</p>
        <p className="text-[1.1vw]">✗ Do not swear</p>
      </div>
    </div>
  )
}
