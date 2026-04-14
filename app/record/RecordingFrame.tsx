'use client'
import { TARGET_URL, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM } from '@/app/config'

const IFRAME_WIDTH = Math.round(VIDEO_WIDTH / RENDER_ZOOM)
const IFRAME_HEIGHT = Math.round(VIDEO_HEIGHT / RENDER_ZOOM)

type Props = {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  scale: number
  product: string
  recordingKey?: number
  targetUrl?: string
  queryParam?: string
  children?: React.ReactNode
}

export default function RecordingFrame({ iframeRef, containerRef, scale, product, recordingKey, targetUrl, queryParam = 'product', children }: Props) {
  const baseUrl = targetUrl ?? TARGET_URL
  const src = product ? `${baseUrl}?${queryParam}=${product}` : baseUrl

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden shadow-lg"
      style={{ width: '100%', maxHeight: '100%', aspectRatio: `${IFRAME_WIDTH} / ${IFRAME_HEIGHT}` }}
    >
      <iframe
        key={`${product || 'default'}-${recordingKey ?? 0}`}
        ref={iframeRef}
        src={src}
        className="border-0"
        style={{
          display: 'block',
          width: `${IFRAME_WIDTH}px`,
          height: `${IFRAME_HEIGHT}px`,
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
