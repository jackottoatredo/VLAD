'use client'
import { useEffect, useRef, useState } from 'react'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import RecordingControlPanel from '@/app/record/RecordingControlPanel'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import { VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, WEBCAM_RECORDER_TIMESLICE_MS } from '@/app/config'

const IFRAME_WIDTH = Math.round(VIDEO_WIDTH / RENDER_ZOOM)
const IFRAME_HEIGHT = Math.round(VIDEO_HEIGHT / RENDER_ZOOM)

type RelayEvent = {
  eventType: string
  x: number
  y: number
  buttons: number
  timestamp: number
}

export default function MerchantPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const eventsRef = useRef<RelayEvent[]>([])
  const [scale, setScale] = useState(1)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingComplete, setRecordingComplete] = useState(false)
  const [product, setProduct] = useState('')
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
      setScale(entry.contentRect.width / IFRAME_WIDTH)
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
        virtualWidth: IFRAME_WIDTH,
        virtualHeight: IFRAME_HEIGHT,
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
    setRecordingComplete(true)
  }

  return (
    <>
      <PageLayout
        instructions={
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
        }
        settings={
          <RecordingControlPanel
            isRecording={isRecording}
            onStart={handleStart}
            onStop={handleStop}
            product={product}
            onProductChange={setProduct}
          />
        }
      >
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-300 p-[10px] dark:border-zinc-700">
          {recordingComplete ? (
            <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
              Merchant intro recorded — continue to Review
            </p>
          ) : (
            <RecordingFrame iframeRef={iframeRef} containerRef={containerRef} scale={scale} product={product}>
              <WebcamOverlay videoRef={webcamVideoRef} scale={scale} mirror />
            </RecordingFrame>
          )}
        </div>
      </PageLayout>
      <PageNav back={{ label: 'Product Preview', href: '/preview' }} forward={{ label: 'Review', href: '/review' }} />
    </>
  )
}
