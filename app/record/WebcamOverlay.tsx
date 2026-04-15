'use client'
import type { WebcamSettings } from '@/types/webcam'
import VideoOverlay from '@/app/record/VideoOverlay'
import AudioOverlay from '@/app/record/AudioOverlay'

type Props = {
  webcamSettings: WebcamSettings
  videoRef: React.RefObject<HTMLVideoElement | null>
  mirror?: boolean
}

export default function WebcamOverlay({ webcamSettings, videoRef, mirror }: Props) {
  if (webcamSettings.webcamMode === 'off') return null

  if (webcamSettings.webcamMode === 'audio') {
    return (
      <AudioOverlay
        vertical={webcamSettings.webcamVertical}
        horizontal={webcamSettings.webcamHorizontal}
      />
    )
  }

  return (
    <VideoOverlay
      videoRef={videoRef}
      vertical={webcamSettings.webcamVertical}
      horizontal={webcamSettings.webcamHorizontal}
      mirror={mirror}
    />
  )
}
