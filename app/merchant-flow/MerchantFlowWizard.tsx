'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useMerchantFlow, type MerchantFlowStep } from '@/app/contexts/MerchantFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import { useNavigationGuard, type GuardPrompt } from '@/app/contexts/NavigationGuardContext'
import FlowStepper, { type StepState } from '@/app/components/FlowStepper'
import PageLayout from '@/app/components/PageLayout'
import RecordStep from '@/app/merchant-flow/steps/RecordStep'
import PostprocessStep from '@/app/merchant-flow/steps/PostprocessStep'
import SavedStep from '@/app/merchant-flow/steps/SavedStep'

const STEPS = ['Record', 'Postprocess', 'Saved']

export default function MerchantFlowWizard() {
  const { presenter } = useUser()
  const flow = useMerchantFlow()
  const recording = useRecording({
    webcamMode: flow.webcamSettings.webcamMode,
    onCommitted: flow.hydrateCommitted,
  })
  const { setGuard } = useNavigationGuard()

  const reopened = flow.origin === 'reopened'

  const stepStates = useMemo<StepState[]>(() => {
    const recordComplete = !!flow.flowId
    const postprocessComplete = recordComplete && !!flow.postprocessVideoUrl
    const savedComplete = flow.persistedStatus === 'saved'
    const completeness = [recordComplete, postprocessComplete, savedComplete]
    return STEPS.map((_, i) => {
      if (i === flow.step) return 'current'
      if (reopened && i === 0) return 'locked'
      const allPrevComplete = completeness.slice(0, i).every(Boolean)
      if (!allPrevComplete) return 'locked'
      return completeness[i] ? 'complete' : 'incomplete'
    })
  }, [flow.step, reopened, flow.flowId, flow.postprocessVideoUrl, flow.persistedStatus])

  const goTo = useCallback((s: number) => {
    if (stepStates[s] === 'locked') return
    flow.setStep(s as MerchantFlowStep)
  }, [flow, stepStates])

  useEffect(() => {
    const guardFn = (): GuardPrompt | null => {
      const hasPendingTake = recording.uploadStatus === 'ready'
      if (!flow.hasUnsavedChanges() && !hasPendingTake) return null
      const prefix = flow.merchantId || 'merchant'
      const defaultSuffix = (() => {
        if (flow.name && prefix && flow.name.startsWith(`${prefix}-`)) return flow.name.slice(prefix.length + 1)
        return ''
      })()
      return {
        flowLabel: 'merchant flow',
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
                type: 'merchant',
                merchantId: flow.merchantId,
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
        <FlowStepper steps={STEPS} stepStates={stepStates} onStepClick={goTo} />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {flow.step === 0 && <RecordStep recording={recording} navForward={navForward} />}
        {flow.step === 1 && <PostprocessStep navBack={navBack} navForward={navForward} />}
        {flow.step === 2 && <SavedStep />}
      </div>
    </div>
  )
}
