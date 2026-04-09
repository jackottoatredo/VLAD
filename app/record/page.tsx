'use client'
import { useEffect, useRef, useState } from 'react'
import RecordingControls from '@/app/components/RecordingControls'
import PageNav from '@/app/components/PageNav'
import {
  TARGET_URL, VIRTUAL_WIDTH, VIRTUAL_HEIGHT,
  WEBCAM_OVERLAY_DIAMETER, WEBCAM_OVERLAY_PADDING,
  WEBCAM_BORDER_THICKNESS, WEBCAM_SHADOW_RADIUS, WEBCAM_BORDER_COLOR,
  WEBCAM_RECORDER_TIMESLICE_MS,
} from '@/lib/config'

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

  // Webcam
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const webcamChunksRef = useRef<Blob[]>([])
  const recordingStartedAt = useRef<string>('')
  const webcamVideoRef = useRef<HTMLVideoElement>(null)
  const webcamDimsRef = useRef<{ width: number; height: number } | null>(null)

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
      if (isRecording) eventsRef.current.push(event)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isRecording])

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream
        if (webcamVideoRef.current) webcamVideoRef.current.srcObject = stream
        const settings = stream.getVideoTracks()[0]?.getSettings()
        if (settings?.width && settings?.height) {
          webcamDimsRef.current = { width: settings.width, height: settings.height }
        }
      })
      .catch(() => {})

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function handleStart(sessionName: string) {
    sessionNameRef.current = sessionName
    const startTime = Date.now()
    recordingStartedAt.current = new Date(startTime).toISOString()
    eventsRef.current = [{ eventType: 'recording-start', x: 0, y: 0, buttons: 0, timestamp: startTime }]
    setIsRecording(true)

    if (streamRef.current) {
      webcamChunksRef.current = []
      const mr = new MediaRecorder(streamRef.current, { mimeType: 'video/webm' })
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) webcamChunksRef.current.push(e.data)
      }
      mediaRecorderRef.current = mr
      mr.start(WEBCAM_RECORDER_TIMESLICE_MS)
    }
  }

  async function handleStop() {
    setIsRecording(false)

    const sessionName = sessionNameRef.current

    const mousePromise = fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sessionName,
        recordedAt: recordingStartedAt.current,
        virtualWidth: VIRTUAL_WIDTH,
        virtualHeight: VIRTUAL_HEIGHT,
        events: eventsRef.current,
      }),
    })

    const webcamPromise = new Promise<void>((resolve) => {
      const mr = mediaRecorderRef.current
      if (!mr || mr.state === 'inactive') { resolve(); return }
      mr.onstop = async () => {
        const blob = new Blob(webcamChunksRef.current, { type: 'video/webm' })
        const fd = new FormData()
        fd.append('session', sessionName)
        fd.append('video', blob, `${sessionName}_webcam.webm`)
        fd.append('startedAt', recordingStartedAt.current)
        if (webcamDimsRef.current) {
          fd.append('width', String(webcamDimsRef.current.width))
          fd.append('height', String(webcamDimsRef.current.height))
        }
        await fetch('/api/save-webcam', { method: 'POST', body: fd }).catch(() => {})
        resolve()
      }
      mr.stop()
    })

    await Promise.all([mousePromise, webcamPromise])
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
            ref={webcamVideoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
      <PageNav back={{ label: 'Home', href: '/' }} forward={{ label: 'Rendering', href: '/render' }} />
    </div>
  )
}
