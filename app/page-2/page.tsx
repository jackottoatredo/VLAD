'use client'
import { useEffect, useRef, useState } from 'react'

const VIRTUAL_WIDTH = 1280
const VIRTUAL_HEIGHT = 720

export default function Page2() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / VIRTUAL_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.source !== 'mouse-relay') return
      if (e.source !== iframeRef.current?.contentWindow) return
      const { eventType, x, y, buttons, timestamp } = e.data.payload
      console.log({ eventType, x, y, buttons, timestamp })
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div
        ref={containerRef}
        className="overflow-hidden shadow-lg"
        style={{ width: '75vw', aspectRatio: `${VIRTUAL_WIDTH} / ${VIRTUAL_HEIGHT}` }}
      >
        <iframe
          key="iframe"
          ref={iframeRef}
          // src="https://www.redo.com"
          src="http://localhost:1111/"
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
      </div>
    </div>
  )
}
