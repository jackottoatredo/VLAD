'use client'
import { TARGET_URL, VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from '@/app/config'

type Props = {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  scale: number
  children?: React.ReactNode
}

export default function RecordingFrame({ iframeRef, containerRef, scale, children }: Props) {
  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden shadow-lg"
      style={{ width: '75vw', aspectRatio: `${VIRTUAL_WIDTH} / ${VIRTUAL_HEIGHT}` }}
    >
      <iframe
        key="iframe"
        ref={iframeRef}
        src={TARGET_URL}
        className="border-0"
        style={{
          display: 'block',
          width: `${VIRTUAL_WIDTH}px`,
          height: `${VIRTUAL_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
        title="redo.com"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
      />
      {children}
    </div>
  )
}
