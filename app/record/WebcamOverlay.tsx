'use client'
import type { WebcamSettings } from '@/types/webcam'
import VideoOverlay from '@/app/record/VideoOverlay'
import AudioOverlay from '@/app/record/AudioOverlay'

type Props = {
  webcamSettings: WebcamSettings
  videoRef: React.RefObject<HTMLVideoElement | null>
  scale: number
  mirror?: boolean
}

export default function WebcamOverlay({ webcamSettings, videoRef, scale, mirror }: Props) {
  if (webcamSettings.webcamMode === 'off') return null

  if (webcamSettings.webcamMode === 'audio') {
    return (
      <AudioOverlay
        vertical={webcamSettings.webcamVertical}
        horizontal={webcamSettings.webcamHorizontal}
        scale={scale}
      />
    )
  }

  return (
    <VideoOverlay
      videoRef={videoRef}
      vertical={webcamSettings.webcamVertical}
      horizontal={webcamSettings.webcamHorizontal}
      scale={scale}
      mirror={mirror}
    />
  )
}
