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
import { MicIcon } from '@/app/components/icons'

type Props = {
  vertical: WebcamVertical
  horizontal: WebcamHorizontal
}

export default function AudioOverlay({ vertical, horizontal }: Props) {
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
      }}
    >
      <MicIcon style={{ width: '40%', height: '40%' }} />
    </div>
  )
}
