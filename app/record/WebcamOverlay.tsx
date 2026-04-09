'use client'
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_PADDING,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_SHADOW_RADIUS,
  WEBCAM_BORDER_COLOR,
} from '@/lib/config'

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  scale: number
  mirror?: boolean
}

export default function WebcamOverlay({ videoRef, scale, mirror = false }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: WEBCAM_OVERLAY_PADDING * scale,
        left: WEBCAM_OVERLAY_PADDING * scale,
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
