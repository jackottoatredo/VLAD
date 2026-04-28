'use client'

import Modal from './Modal'

type Props = {
  name: string
  onConfirm: () => void
  onClose: () => void
}

export default function DeleteModal({ name, onConfirm, onClose }: Props) {
  return (
    <Modal title="Confirm Delete" onClose={onClose}>
      <p className="text-sm text-muted">
        Are you sure you want to delete <span className="text-foreground">{name}</span>?
      </p>
      <div className="mt-4 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
        >
          Delete
        </button>
      </div>
    </Modal>
  )
}
