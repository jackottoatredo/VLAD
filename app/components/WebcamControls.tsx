'use client'
import type { WebcamSettings, WebcamMode, WebcamVertical, WebcamHorizontal } from '@/types/webcam'

type Props = {
  settings: WebcamSettings
  onChange: (settings: WebcamSettings) => void
  disabled?: boolean
}

const MODES: { value: WebcamMode; label: string }[] = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'off', label: 'Off' },
]

type Corner = { v: WebcamVertical; h: WebcamHorizontal }
const CORNERS: Corner[] = [
  { v: 'top', h: 'left' },
  { v: 'top', h: 'right' },
  { v: 'bottom', h: 'left' },
  { v: 'bottom', h: 'right' },
]

function CornerPicker({
  vertical,
  horizontal,
  onChange,
  disabled,
}: {
  vertical: WebcamVertical
  horizontal: WebcamHorizontal
  onChange: (v: WebcamVertical, h: WebcamHorizontal) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1.5 rounded-md border border-zinc-300 p-1.5 dark:border-zinc-700">
      {CORNERS.map(({ v, h }) => {
        const active = vertical === v && horizontal === h
        return (
          <button
            key={`${v}-${h}`}
            onClick={() => onChange(v, h)}
            disabled={disabled}
            className={`h-4 w-4 rounded-full border-2 transition-colors disabled:opacity-50 ${
              active
                ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100'
                : 'border-zinc-300 bg-transparent hover:border-zinc-500 dark:border-zinc-600 dark:hover:border-zinc-400'
            }`}
            title={`${v}-${h}`}
          />
        )
      })}
    </div>
  )
}

export default function WebcamControls({ settings, onChange, disabled }: Props) {
  const showPosition = settings.webcamMode !== 'off'

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Webcam</p>

      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          {MODES.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...settings, webcamMode: opt.value })}
              disabled={disabled}
              className={`flex-1 px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                settings.webcamMode === opt.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {showPosition && (
          <CornerPicker
            vertical={settings.webcamVertical}
            horizontal={settings.webcamHorizontal}
            onChange={(webcamVertical, webcamHorizontal) =>
              onChange({ ...settings, webcamVertical, webcamHorizontal })
            }
            disabled={disabled}
          />
        )}
      </div>
    </div>
  )
}
