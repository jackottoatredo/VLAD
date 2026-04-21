'use client'
import { useState } from 'react'
import type { WebcamSettings, WebcamMode, WebcamVertical, WebcamHorizontal } from '@/types/webcam'
import { DEFAULT_WEBCAM_SETTINGS } from '@/types/webcam'

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

const VERTICALS: WebcamVertical[] = ['top', 'bottom']
const HORIZONTALS: WebcamHorizontal[] = ['left', 'right']

const SELECT_CLASS =
  'flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'

export default function WebcamControls({ settings, onChange, disabled }: Props) {
  const [useDefaults, setUseDefaults] = useState(true)

  const toggleDefaults = () => {
    if (useDefaults) {
      setUseDefaults(false)
    } else {
      setUseDefaults(true)
      onChange(DEFAULT_WEBCAM_SETTINGS)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Webcam</p>
        <label className="flex items-center gap-1.5 text-xs italic text-zinc-400 dark:text-zinc-500 select-none">
          <span>use defaults</span>
          <input
            type="checkbox"
            checked={useDefaults}
            onChange={toggleDefaults}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
          />
        </label>
      </div>

      {!useDefaults && (
        <>
          <div className="flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden">
            {MODES.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChange({ ...settings, webcamMode: opt.value })}
                disabled={disabled}
                className={`flex-1 px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                  settings.webcamMode === opt.value
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <select
              value={settings.webcamVertical}
              onChange={(e) => onChange({ ...settings, webcamVertical: e.target.value as WebcamVertical })}
              disabled={disabled}
              className={SELECT_CLASS}
            >
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              value={settings.webcamHorizontal}
              onChange={(e) => onChange({ ...settings, webcamHorizontal: e.target.value as WebcamHorizontal })}
              disabled={disabled}
              className={SELECT_CLASS}
            >
              {HORIZONTALS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  )
}
