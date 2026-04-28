'use client'
import { useState } from 'react'
import Select from '@/app/components/Select'
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

const VERTICAL_OPTIONS: { value: WebcamVertical; label: string }[] = [
  { value: 'top', label: 'top' },
  { value: 'bottom', label: 'bottom' },
]

const HORIZONTAL_OPTIONS: { value: WebcamHorizontal; label: string }[] = [
  { value: 'left', label: 'left' },
  { value: 'right', label: 'right' },
]

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
        <p className="text-xs font-medium text-muted">Webcam</p>
        <label className="flex items-center gap-1.5 text-xs italic text-muted opacity-80 select-none">
          <span>use defaults</span>
          <input
            type="checkbox"
            checked={useDefaults}
            onChange={toggleDefaults}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-foreground"
          />
        </label>
      </div>

      {!useDefaults && (
        <>
          <div className="flex rounded-md border border-border overflow-hidden">
            {MODES.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChange({ ...settings, webcamMode: opt.value })}
                disabled={disabled}
                className={`flex-1 px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                  settings.webcamMode === opt.value
                    ? 'bg-accent text-white'
                    : 'bg-surface text-muted hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Select
              size="sm"
              className="flex-1"
              options={VERTICAL_OPTIONS}
              value={settings.webcamVertical}
              onChange={(v) => onChange({ ...settings, webcamVertical: v as WebcamVertical })}
              disabled={disabled}
            />
            <Select
              size="sm"
              className="flex-1"
              options={HORIZONTAL_OPTIONS}
              value={settings.webcamHorizontal}
              onChange={(v) => onChange({ ...settings, webcamHorizontal: v as WebcamHorizontal })}
              disabled={disabled}
            />
          </div>
        </>
      )}
    </div>
  )
}
