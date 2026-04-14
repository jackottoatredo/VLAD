'use client'
import { useEffect, useRef, useState } from 'react'
import RecordingFrame from '@/app/record/RecordingFrame'
import WebcamOverlay from '@/app/record/WebcamOverlay'
import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'
import WebcamControls from '@/app/components/WebcamControls'
import { VIDEO_WIDTH, VIDEO_HEIGHT, RENDER_ZOOM, WEBCAM_RECORDER_TIMESLICE_MS } from '@/app/config'
import { useAppContext } from '@/app/appContext'

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
  const {
    users, merchants, addUser, addMerchant,
    merchant: merchantDraft,
    setMerchantPresenter, setMerchantMerchantId, setMerchantWebcamSettings,
    clearMerchantPipelineCache,
  } = useAppContext()

  const { presenter, merchantId: selectedMerchantId, session: sessionName, webcamSettings } = merchantDraft
  const selectedMerchant = merchants.find((m) => m.id === selectedMerchantId)
  const brand = selectedMerchant?.url ?? ''

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const eventsRef = useRef<RelayEvent[]>([])
  const [scale, setScale] = useState(1)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingComplete, setRecordingComplete] = useState(false)
  const sessionNameRef = useRef('')
  const presenterRef = useRef('')

  // Add user modal
  const [showAddUser, setShowAddUser] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [addUserError, setAddUserError] = useState('')

  // Add merchant modal
  const [showAddMerchant, setShowAddMerchant] = useState(false)
  const [merchantName, setMerchantName] = useState('')
  const [merchantUrlInput, setMerchantUrlInput] = useState('')
  const [addMerchantError, setAddMerchantError] = useState('')

  // Webcam
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const webcamChunksRef = useRef<Blob[]>([])
  const recordingStartedAt = useRef<string>('')
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null)

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

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.source !== 'mouse-relay') return
      if (e.source !== iframeRef.current?.contentWindow) return
      const event: RelayEvent = { ...e.data.payload, timestamp: performance.now() }
      if (isRecording) eventsRef.current.push(event)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [isRecording])

  useEffect(() => {
    if (webcamSettings.webcamMode === 'off') {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        streamRef.current = stream
        if (webcamVideoRef.current) webcamVideoRef.current.srcObject = stream
      })
      .catch(() => {})

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [webcamSettings.webcamMode])

  function handleStart() {
    sessionNameRef.current = sessionName
    presenterRef.current = presenter
    recordingStartedAt.current = new Date().toISOString()
    eventsRef.current = [{ eventType: 'recording-start', x: 0, y: 0, buttons: 0, timestamp: performance.now() }]
    setIsRecording(true)
    setRecordingComplete(false)

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

    const sn = sessionNameRef.current
    const pres = presenterRef.current

    const mousePromise = fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sn,
        presenter: pres,
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
        fd.append('session', sn)
        fd.append('presenter', pres)
        fd.append('video', blob, `${sn}_webcam.webm`)
        await fetch('/api/save-webcam', { method: 'POST', body: fd }).catch(() => {})
        resolve()
      }
      mr.stop()
    })

    await Promise.all([mousePromise, webcamPromise])
    clearMerchantPipelineCache()
    setRecordingComplete(true)
  }

  async function handleAddUser() {
    setAddUserError('')
    const res = await fetch('/api/add-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
    })
    const data = await res.json() as { ok?: boolean; userId?: string; error?: string }
    if (!res.ok || !data.ok) {
      setAddUserError(data.error ?? 'Failed to add user.')
      return
    }
    addUser(data.userId!)
    setMerchantPresenter(data.userId!)
    setFirstName('')
    setLastName('')
    setShowAddUser(false)
  }

  async function handleAddMerchant() {
    setAddMerchantError('')
    const res = await fetch('/api/add-merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: merchantName.trim(), url: merchantUrlInput.trim() }),
    })
    const data = await res.json() as { ok?: boolean; merchant?: { id: string; name: string; url: string }; error?: string }
    if (!res.ok || !data.ok || !data.merchant) {
      setAddMerchantError(data.error ?? 'Failed to add merchant.')
      return
    }
    addMerchant(data.merchant)
    setMerchantMerchantId(data.merchant.id)
    setMerchantName('')
    setMerchantUrlInput('')
    setShowAddMerchant(false)
  }

  const canStart = !!sessionName && !isRecording

  return (
    <>
      <PageLayout
        instructions={
          <p>Record a merchant customization walkthrough. Select a presenter and merchant, then start recording.</p>
        }
        settings={
          <>
            {/* Presenter */}
            <div className="flex gap-1">
              <select
                value={presenter}
                onChange={(e) => setMerchantPresenter(e.target.value)}
                disabled={isRecording}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="">Select presenter…</option>
                {users.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAddUser(true)}
                disabled={isRecording}
                className="flex items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                title="Add new user"
              >
                +
              </button>
            </div>

            {/* Merchant */}
            <div className="flex gap-1">
              <select
                value={selectedMerchantId}
                onChange={(e) => setMerchantMerchantId(e.target.value)}
                disabled={isRecording}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="">Select merchant…</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowAddMerchant(true)}
                disabled={isRecording}
                className="flex items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                title="Add new merchant"
              >
                +
              </button>
            </div>

            <WebcamControls
              settings={webcamSettings}
              onChange={setMerchantWebcamSettings}
              disabled={isRecording}
            />

            <button
              onClick={isRecording ? handleStop : handleStart}
              disabled={!isRecording && !canStart}
              className={`w-full rounded-md px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed text-white ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300'
              }`}
            >
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </button>
          </>
        }
      >
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-300 p-[10px] dark:border-zinc-700">
          {recordingComplete ? (
            <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
              Merchant intro recorded — continue to Merchant Postprocessing
            </p>
          ) : (
            <RecordingFrame
              iframeRef={iframeRef}
              containerRef={containerRef}
              scale={scale}
              product={brand}
              targetUrl="http://search.redo.com/record"
              queryParam="brand"
            >
              <WebcamOverlay webcamSettings={webcamSettings} videoRef={webcamVideoRef} scale={scale} mirror />
            </RecordingFrame>
          )}
        </div>
      </PageLayout>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Add New User</h2>
            <div className="flex flex-col gap-3">
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              {addUserError && <p className="text-xs text-red-500">{addUserError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowAddUser(false); setFirstName(''); setLastName(''); setAddUserError('') }} className="flex-1 rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
                <button onClick={handleAddUser} disabled={!firstName.trim() || !lastName.trim()} className="flex-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Merchant Modal */}
      {showAddMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-4 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Add New Merchant</h2>
            <div className="flex flex-col gap-3">
              <input type="text" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="Company name" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              <input type="text" value={merchantUrlInput} onChange={(e) => setMerchantUrlInput(e.target.value)} placeholder="mammut.com" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              {addMerchantError && <p className="text-xs text-red-500">{addMerchantError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowAddMerchant(false); setMerchantName(''); setMerchantUrlInput(''); setAddMerchantError('') }} className="flex-1 rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
                <button onClick={handleAddMerchant} disabled={!merchantName.trim() || !merchantUrlInput.trim().includes('.')} className="flex-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PageNav back={{ label: 'Product Preview', href: '/preview' }} forward={{ label: 'Merchant Postprocessing', href: '/merchant-postprocess' }} />
    </>
  )
}
