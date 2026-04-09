'use client'
import RecordingControlPanel from './RecordingControlPanel'

type Props = {
  isRecording: boolean
  onStart: (sessionName: string, presenter: string) => void
  onStop: () => void
}

export default function RecordingTools({ isRecording, onStart, onStop }: Props) {
  return (
    <div className="flex w-full gap-[10px]">
      <div className="w-1/2">
        <RecordingControlPanel isRecording={isRecording} onStart={onStart} onStop={onStop} />
      </div>
      <div className="flex w-1/2 flex-col gap-2 overflow-hidden rounded-xl border border-zinc-200 px-[1.5vw] py-[1vw] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <p className="text-[1vw] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Instructions:</p>
        <p className="text-[1.1vw]">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
      </div>
    </div>
  )
}
