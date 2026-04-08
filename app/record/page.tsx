'use client'
import { useEffect, useRef, useState } from 'react'
import RecordingControls from '@/app/components/RecordingControls'

const VIRTUAL_WIDTH = 1280
const VIRTUAL_HEIGHT = 720

type RelayEvent = {
  eventType: string
  x: number
  y: number
  buttons: number
  timestamp: number
}

export default function RecordPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const eventsRef = useRef<RelayEvent[]>([])
  const [scale, setScale] = useState(1)
  const [isRecording, setIsRecording] = useState(false)
  const sessionNameRef = useRef('')

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
      const event: RelayEvent = e.data.payload
      console.log(event)
      if (isRecording) eventsRef.current.push(event)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isRecording])

  function handleStart(sessionName: string) {
    sessionNameRef.current = sessionName
    eventsRef.current = []
    setIsRecording(true)
  }

  async function handleStop() {
    setIsRecording(false)
    await fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sessionNameRef.current,
        recordedAt: new Date().toISOString(),
        virtualWidth: VIRTUAL_WIDTH,
        virtualHeight: VIRTUAL_HEIGHT,
        events: eventsRef.current,
      }),
    })
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <RecordingControls
        isRecording={isRecording}
        onStart={handleStart}
        onStop={handleStop}
      />
      <div
        ref={containerRef}
        className="overflow-hidden shadow-lg"
        style={{ width: '75vw', aspectRatio: `${VIRTUAL_WIDTH} / ${VIRTUAL_HEIGHT}` }}
      >
        <iframe
          key="iframe"
          ref={iframeRef}
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
