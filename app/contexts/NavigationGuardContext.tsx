'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import UnsavedChangesModal from '@/app/components/UnsavedChangesModal'
import NameRecordingModal from '@/app/components/NameRecordingModal'

export type GuardPrompt = {
  flowLabel: string
  prefix: string
  defaultSuffix: string
  onSaveDraft: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onDiscard: () => Promise<void>
}

export type GuardFn = () => GuardPrompt | null

type Ctx = {
  setGuard: (fn: GuardFn | null) => void
  tryNavigate: (href: string) => void
  tryAction: (run: () => void) => void
}

const NavigationGuardContext = createContext<Ctx | null>(null)

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<GuardFn | null>(null)
  const router = useRouter()
  const [unsavedModal, setUnsavedModal] = useState<{ prompt: GuardPrompt; resolve: () => void } | null>(null)
  const [nameModal, setNameModal] = useState<{ prompt: GuardPrompt; resolve: () => void } | null>(null)
  const [busy, setBusy] = useState(false)

  const setGuard = useCallback((fn: GuardFn | null) => {
    guardRef.current = fn
  }, [])

  const attempt = useCallback((action: () => void) => {
    const prompt = guardRef.current?.() ?? null
    if (!prompt) {
      action()
      return
    }
    setUnsavedModal({ prompt, resolve: action })
  }, [])

  const tryNavigate = useCallback((href: string) => {
    attempt(() => router.push(href))
  }, [attempt, router])

  const tryAction = useCallback((run: () => void) => {
    attempt(run)
  }, [attempt])

  const value = useMemo<Ctx>(() => ({ setGuard, tryNavigate, tryAction }), [setGuard, tryNavigate, tryAction])

  const handleKeepEditing = () => setUnsavedModal(null)

  const handleDiscard = async () => {
    if (!unsavedModal) return
    setBusy(true)
    try {
      await unsavedModal.prompt.onDiscard()
    } catch {
      /* continue anyway */
    }
    setBusy(false)
    const resolve = unsavedModal.resolve
    setUnsavedModal(null)
    // Clear guard so the resolve action doesn't get re-prompted.
    guardRef.current = null
    resolve()
  }

  const handleSaveDraftClick = () => {
    if (!unsavedModal) return
    const m = unsavedModal
    setUnsavedModal(null)
    setNameModal({ prompt: m.prompt, resolve: m.resolve })
  }

  const handleNameSubmit = async (name: string) => {
    if (!nameModal) return { ok: false as const, error: 'no modal' }
    setBusy(true)
    const res = await nameModal.prompt.onSaveDraft(name)
    setBusy(false)
    if (!res.ok) return res
    const resolve = nameModal.resolve
    setNameModal(null)
    guardRef.current = null
    resolve()
    return res
  }

  const handleNameCancel = () => {
    if (busy) return
    setNameModal(null)
  }

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      {unsavedModal && (
        <UnsavedChangesModal
          flowLabel={unsavedModal.prompt.flowLabel}
          onSaveDraft={handleSaveDraftClick}
          onDiscard={handleDiscard}
          onKeepEditing={handleKeepEditing}
          busy={busy}
        />
      )}
      {nameModal && (
        <NameRecordingModal
          title="Save as Draft"
          prefix={nameModal.prompt.prefix}
          defaultSuffix={nameModal.prompt.defaultSuffix}
          submitLabel="Save Draft"
          onSubmit={handleNameSubmit}
          onCancel={handleNameCancel}
        />
      )}
    </NavigationGuardContext.Provider>
  )
}

export function useNavigationGuard(): Ctx {
  const ctx = useContext(NavigationGuardContext)
  if (!ctx) throw new Error('useNavigationGuard must be used within NavigationGuardProvider')
  return ctx
}
