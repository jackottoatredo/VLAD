'use client'
import { useEffect, useRef, useState } from 'react'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import RecordingTools from '@/app/record/RecordingTools'
import PageNav from '@/app/components/PageNav'
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, WEBCAM_RECORDER_TIMESLICE_MS } from '@/app/config'

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
  const presenterRef = useRef('')

  // Webcam
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const webcamChunksRef = useRef<Blob[]>([])
  const recordingStartedAt = useRef<string>('')
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null)
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

  function handleStart(sessionName: string, presenter: string) {
    sessionNameRef.current = sessionName
    presenterRef.current = presenter
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
    const presenter = presenterRef.current

    const mousePromise = fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sessionName,
        presenter,
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
        fd.append('presenter', presenter)
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
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex flex-1 w-full items-center justify-center py-6">
        <div className="flex w-[75vw] flex-col gap-4">
          <RecordingTools
            isRecording={isRecording}
            onStart={handleStart}
            onStop={handleStop}
          />
          <RecordingFrame iframeRef={iframeRef} containerRef={containerRef} scale={scale}>
            <WebcamOverlay videoRef={webcamVideoRef} scale={scale} mirror />
          </RecordingFrame>
        </div>
      </div>
      <div className="flex w-full justify-center pb-20">
        
      </div>
      <PageNav back={{ label: 'Home', href: '/' }} forward={{ label: 'Rendering', href: '/render' }} />
    </div>
  )
}
