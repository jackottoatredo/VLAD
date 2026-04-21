'use client'

import { useState } from 'react'
import Modal from './Modal'

type Props = {
  title: string
  videoUrl?: string | null
  downloadName?: string
  onClose: () => void
  onDelete?: () => void
}

export default function PreviewModal({ title, videoUrl, downloadName, onClose, onDelete }: Props) {
  const [copied, setCopied] = useState(false)

  // Stream from our API for playback (authed, no presign needed)
  const streamUrl = videoUrl ? `/api/stream?key=${encodeURIComponent(videoUrl)}` : null
  const downloadUrl = videoUrl
    ? `/api/stream?key=${encodeURIComponent(videoUrl)}${downloadName ? `&filename=${encodeURIComponent(downloadName)}` : ''}`
    : null

  async function handleCopy() {
    if (!videoUrl) return
    try {
      const res = await fetch(`/api/presign?key=${encodeURIComponent(videoUrl)}`)
      const data = await res.json()
      if (data.url) {
        await navigator.clipboard.writeText(data.url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-background">
        {streamUrl ? (
          <video src={streamUrl} controls className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-muted">Media preview coming soon</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-4">
        {videoUrl && (
          <button
            onClick={handleCopy}
            className={`transition-colors ${copied ? 'text-green-500' : 'text-muted hover:text-foreground'}`}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
          </button>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={downloadName ? `${downloadName}.mp4` : true}
            className="text-muted transition-colors hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-muted transition-colors hover:text-red-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>
    </Modal>
  )
}
