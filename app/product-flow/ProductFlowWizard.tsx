'use client'

import { useEffect, useMemo } from 'react'
import { useProductFlow, type ProductFlowStep } from '@/app/contexts/ProductFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import { useNavigationGuard, type GuardPrompt } from '@/app/contexts/NavigationGuardContext'
import FlowStepper, { type StepState } from '@/app/components/FlowStepper'
import PageLayout from '@/app/components/PageLayout'
import RecordStep from '@/app/product-flow/steps/RecordStep'
import PostprocessStep from '@/app/product-flow/steps/PostprocessStep'
import PreviewStep from '@/app/product-flow/steps/PreviewStep'
import SavedStep from '@/app/product-flow/steps/SavedStep'
import { PREVIEW_BRANDS } from '@/app/config'

const STEPS = ['Record', 'Postprocess', 'Preview', 'Saved']

export default function ProductFlowWizard() {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const recording = useRecording({
    webcamMode: flow.webcamSettings.webcamMode,
    onCommitted: flow.hydrateCommitted,
  })
  const { setGuard } = useNavigationGuard()

  // Reopened flows have the Record step locked even if its data exists.
  const reopened = flow.origin === 'reopened'

  const stepStates = useMemo<StepState[]>(() => {
    const recordComplete = !!flow.flowId
    const postprocessComplete = recordComplete && !!flow.postprocessVideoUrl
    const previewComplete = postprocessComplete && PREVIEW_BRANDS.every((b) => !!flow.brandVideoUrls[b])
    const savedComplete = flow.persistedStatus === 'saved'
    const completeness = [recordComplete, postprocessComplete, previewComplete, savedComplete]
    return STEPS.map((_, i) => {
      if (i === flow.step) return 'current'
      if (reopened && i === 0) return 'locked'
      const allPrevComplete = completeness.slice(0, i).every(Boolean)
      if (!allPrevComplete) return 'locked'
      return completeness[i] ? 'complete' : 'incomplete'
    })
  }, [flow.step, reopened, flow.flowId, flow.postprocessVideoUrl, flow.brandVideoUrls, flow.persistedStatus])

  // Register navigation guard.
  useEffect(() => {
    const guardFn = (): GuardPrompt | null => {
      // A recorded-but-not-committed take only lives in useRecording's pendingRef.
      // If the user navigates away now, we'd lose it silently. Guarding on
      // uploadStatus === 'ready' catches that case; the Discard path wipes it,
      // the Save-as-Draft path can't save (no flowId) — but in practice the
      // overlay is on screen so the user is more likely to hit Continue first.
      const hasPendingTake = recording.uploadStatus === 'ready'
      if (!flow.hasUnsavedChanges() && !hasPendingTake) return null
      const prefix = flow.product || 'product'
      const defaultSuffix = (() => {
        if (flow.name && prefix && flow.name.startsWith(`${prefix}-`)) return flow.name.slice(prefix.length + 1)
        return ''
      })()
      return {
        flowLabel: 'product flow',
        prefix,
        defaultSuffix,
        onSaveDraft: async (name: string) => {
          if (!flow.flowId) return { ok: false, error: 'Nothing to save.' }
          try {
            const res = await fetch('/api/save-recording', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                flowId: flow.flowId,
                name,
                status: 'draft',
                type: 'product',
                productName: flow.product,
                previewVideoR2Key: flow.postprocessVideoR2Key,
                webcamSettings: flow.webcamSettings,
                metadata: { trimStartSec: flow.trimStartSec, trimEndSec: flow.trimEndSec },
              }),
            })
            const data = (await res.json()) as { ok?: boolean; error?: string }
            if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'Save failed.' }
            flow.markPersisted({ name, status: 'draft' })
            return { ok: true }
          } catch {
            return { ok: false, error: 'Unexpected error.' }
          }
        },
        onDiscard: async () => {
          if (flow.flowId) {
            try { await fetch(`/api/sessions/${flow.flowId}`, { method: 'DELETE' }) } catch { /* ignore */ }
          }
          flow.reset()
        },
      }
    }
    setGuard(guardFn)
    return () => setGuard(null)
  }, [flow, setGuard, recording])

  const goTo = (s: number) => {
    if (stepStates[s] === 'locked') return
    flow.setStep(s as ProductFlowStep)
  }

  const navBack = flow.step > 0 && stepStates[flow.step - 1] !== 'locked'
    ? { label: STEPS[flow.step - 1], onClick: () => goTo(flow.step - 1) }
    : null
  const navForward = flow.step < STEPS.length - 2 && stepStates[flow.step + 1] !== 'locked'
    ? { label: STEPS[flow.step + 1], onClick: () => goTo(flow.step + 1) }
    : null

  if (!presenter) {
    return (
      <PageLayout instructions={<p>Select a presenter on the home page first.</p>} settings={null}>
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-surface shadow-md">
          <p className="text-sm text-muted">No presenter selected</p>
        </div>
      </PageLayout>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-border bg-surface">
        <FlowStepper steps={STEPS} stepStates={stepStates} />
      </div>
      {flow.origin === 'reopened' && flow.name && (
        <p className="pt-3 text-center text-base italic text-muted">
          editing {flow.name}
        </p>
      )}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {flow.step === 0 && <RecordStep recording={recording} navForward={navForward} />}
        {flow.step === 1 && <PostprocessStep navBack={navBack} navForward={navForward} />}
        {flow.step === 2 && <PreviewStep navBack={navBack} navForward={navForward} />}
        {flow.step === 3 && <SavedStep />}
      </div>
    </div>
  )
}
