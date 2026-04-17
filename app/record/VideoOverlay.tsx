'use client'
import type { WebcamVertical, WebcamHorizontal } from '@/types/webcam'
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_SHADOW_RADIUS,
  WEBCAM_BORDER_COLOR,
} from '@/app/config'
import { useFrameScale } from '@/app/record/RecordingFrame'

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  vertical: WebcamVertical
  horizontal: WebcamHorizontal
  mirror?: boolean
}

export default function VideoOverlay({ videoRef, vertical, horizontal, mirror = false }: Props) {
  const scale = useFrameScale()

  return (
    <div
      style={{
        position: 'absolute',
        ...(vertical === 'bottom'
          ? { bottom: WEBCAM_OVERLAY_MARGIN * scale }
          : { top: WEBCAM_OVERLAY_MARGIN * scale }),
        ...(horizontal === 'left'
          ? { left: WEBCAM_OVERLAY_MARGIN * scale }
          : { right: WEBCAM_OVERLAY_MARGIN * scale }),
        width: WEBCAM_OVERLAY_DIAMETER * scale,
        height: WEBCAM_OVERLAY_DIAMETER * scale,
        borderRadius: '50%',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 10,
        border: `${WEBCAM_BORDER_THICKNESS * scale}px solid ${WEBCAM_BORDER_COLOR}`,
        boxShadow: `0 ${Math.round(WEBCAM_SHADOW_RADIUS * scale / 3)}px ${WEBCAM_SHADOW_RADIUS * scale}px rgba(0,0,0,0.5)`,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined }}
      />
    </div>
  )
}
