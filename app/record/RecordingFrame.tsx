'use client'
import { useEffect, useRef, useState } from 'react'
import { TARGET_URL, VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, WEBCAM_BORDER_COLOR } from '@/app/config'

const IFRAME_WIDTH = Math.round(VIDEO_WIDTH / RENDER_ZOOM)
const IFRAME_HEIGHT = Math.round(VIDEO_HEIGHT / RENDER_ZOOM)

type Props = {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  product: string
  recordingKey?: number
  targetUrl?: string
  queryParam?: string
  isRecording?: boolean
  countdown?: number | null
  children?: React.ReactNode
}

export default function RecordingFrame({ iframeRef, product, recordingKey, targetUrl, queryParam = 'product', isRecording, countdown, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setScale(w / IFRAME_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const baseUrl = targetUrl ?? TARGET_URL
  const src = product ? `${baseUrl}?${queryParam}=${product}` : baseUrl

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden shadow-lg"
      style={{
        width: '100%',
        maxHeight: '100%',
        aspectRatio: `${IFRAME_WIDTH} / ${IFRAME_HEIGHT}`,
        border: isRecording ? `1px solid ${WEBCAM_BORDER_COLOR}` : undefined,
      }}
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
      {countdown != null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/50">
          <span className="text-[12rem] font-black leading-none text-orange-500 drop-shadow-lg select-none">
            {countdown}
          </span>
        </div>
      )}
      {/* Re-render children with current scale */}
      <ScaleContext.Provider value={scale}>
        {children}
      </ScaleContext.Provider>
    </div>
  )
}

// Expose scale to overlay children without prop drilling
import { createContext, useContext } from 'react'
const ScaleContext = createContext(1)
export function useFrameScale() { return useContext(ScaleContext) }
