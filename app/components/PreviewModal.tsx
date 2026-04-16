'use client'

import Modal from './Modal'

type Props = {
  title: string
  videoUrl?: string | null
  onClose: () => void
  onDelete?: () => void
}

export default function PreviewModal({ title, videoUrl, onClose, onDelete }: Props) {
  const fullUrl = videoUrl
    ? `${window.location.origin}${videoUrl}`
    : null

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-zinc-800">
        {videoUrl ? (
          <video src={videoUrl} controls className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-zinc-500">Media preview coming soon</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-4">
        {fullUrl && (
          <button
            onClick={() => navigator.clipboard.writeText(fullUrl)}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        )}
        {videoUrl && (
          <a
            href={videoUrl}
            download
            className="text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-zinc-500 transition-colors hover:text-red-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        )}
      </div>
    </Modal>
  )
}
