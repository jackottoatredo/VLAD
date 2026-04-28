'use client'

import Modal from './Modal'

type Props = {
  flowLabel: string
  onSaveDraft: () => void
  onDiscard: () => void
  onKeepEditing: () => void
  busy?: boolean
}

export default function UnsavedChangesModal({
  flowLabel,
  onSaveDraft,
  onDiscard,
  onKeepEditing,
  busy,
}: Props) {
  return (
    <Modal title="Unsaved changes" onClose={onKeepEditing}>
      <p className="text-sm text-muted">
        You have unsaved changes in your {flowLabel}. What would you like to do?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={onSaveDraft}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-80 disabled:opacity-40"
        >
          Save as Draft
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="rounded-md border border-red-500/40 bg-surface px-4 py-2 text-sm font-medium text-red-500 shadow-sm hover:bg-red-500/10 disabled:opacity-40"
        >
          Discard
        </button>
        <button
          onClick={onKeepEditing}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-background disabled:opacity-40"
        >
          Keep Editing
        </button>
      </div>
    </Modal>
  )
}
