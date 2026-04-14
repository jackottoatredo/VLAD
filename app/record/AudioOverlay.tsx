'use client'
import type { WebcamVertical, WebcamHorizontal } from '@/types/webcam'
import {
  WEBCAM_OVERLAY_DIAMETER,
  WEBCAM_OVERLAY_MARGIN,
  WEBCAM_BORDER_THICKNESS,
  WEBCAM_SHADOW_RADIUS,
  WEBCAM_BORDER_COLOR,
} from '@/app/config'

type Props = {
  vertical: WebcamVertical
  horizontal: WebcamHorizontal
  scale: number
}

export default function AudioOverlay({ vertical, horizontal, scale }: Props) {
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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="white"
        style={{ width: '40%', height: '40%' }}
      >
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
      </svg>
    </div>
  )
}
