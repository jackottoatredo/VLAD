'use client'

import { useEffect, useMemo } from 'react'
import { useMerchantFlow, type MerchantFlowStep } from '@/app/contexts/MerchantFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import { useNavigationGuard, type GuardPrompt } from '@/app/contexts/NavigationGuardContext'
import FlowStepper, { type StepState } from '@/app/components/FlowStepper'
import FlowFooter from '@/app/components/FlowFooter'
import PageLayout from '@/app/components/PageLayout'
import RecordStep from '@/app/merchant-flow/steps/RecordStep'
import PostprocessStep from '@/app/merchant-flow/steps/PostprocessStep'
import SaveStep from '@/app/merchant-flow/steps/SaveStep'
import { MERCHANT_TARGET_URL } from '@/app/config'
import { slugifyPart, deriveMerchantNameFromUrl } from '@/lib/naming'

const STEPS = ['Record', 'Postprocess', 'Save']

// Recover the original optional-tag from a saved name like
// `{prefix}-{tag}-{count}` so reopened flows can pre-fill the modal.
// Strips the prefix and any trailing `-N` count suffix.
function extractTagFromName(name: string | null | undefined, prefix: string): string {
  if (!name || !prefix || !name.startsWith(`${prefix}-`)) return ''
  return name.slice(prefix.length + 1).replace(/-(\d+)$/, '')
}

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

  useEffect(() => {
    const guardFn = (): GuardPrompt | null => {
      const hasPendingTake = recording.uploadStatus === 'ready'
      if (!flow.hasUnsavedChanges() && !hasPendingTake) return null
      const prefix = slugifyPart(flow.brandName) || deriveMerchantNameFromUrl(flow.websiteUrl)
      const defaultTag = extractTagFromName(flow.name, prefix)
      return {
        flowLabel: 'merchant flow',
        prefix,
        defaultTag,
        onSaveDraft: async (tag: string) => {
          if (!flow.flowId) return { ok: false, error: 'Nothing to save.' }
          try {
            const res = await fetch('/api/save-recording', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                flowId: flow.flowId,
                tag,
                status: 'draft',
                type: 'merchant',
                merchantId: flow.merchantId,
                previewVideoR2Key: flow.postprocessVideoR2Key,
                webcamSettings: flow.webcamSettings,
                metadata: { merchantUrl: flow.websiteUrl, trimStartSec: flow.trimStartSec, trimEndSec: flow.trimEndSec },
              }),
            })
            const data = (await res.json()) as { ok?: boolean; error?: string; name?: string }
            if (!res.ok || !data.ok || !data.name) return { ok: false, error: data.error ?? 'Save failed.' }
            flow.markPersisted({ name: data.name, status: 'draft' })
            return { ok: true, name: data.name }
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
    flow.setStep(s as MerchantFlowStep)
  }

  // Advance from Record → Postprocess. Commits the pending take (or just
  // advances if already committed) and kicks off the produce job; the
  // PostprocessStep picks up the jobId via context.
  function handleRecordContinue() {
    if (!presenter || !flow.merchantId) return
    const hasCommitted = !!flow.flowId
    if (hasCommitted && recording.uploadStatus === 'idle') {
      flow.setStep(1)
      return
    }
    flow.clearResults()
    flow.setStep(1)
    void (async () => {
      const flowId = await recording.commit()
      if (!flowId) return
      const targetUrl = flow.websiteUrl
        ? `${MERCHANT_TARGET_URL}?brand=${encodeURIComponent(flow.websiteUrl)}`
        : MERCHANT_TARGET_URL
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          presenter, merchantId: flow.merchantId, url: targetUrl,
          webcamMode: flow.webcamSettings.webcamMode,
          webcamVertical: flow.webcamSettings.webcamVertical,
          webcamHorizontal: flow.webcamSettings.webcamHorizontal,
          preview: true,
        }),
      })
        .then((r) => r.json() as Promise<{ jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }>)
        .catch(() => ({} as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }))
      if (res.videoUrl) flow.setPostprocessVideoUrl(res.videoUrl, res.videoR2Key)
      else if (res.jobId) flow.setPostprocessJobId(res.jobId)
    })()
  }

  const navBack = flow.step > 0 && stepStates[flow.step - 1] !== 'locked'
    ? { label: STEPS[flow.step - 1], onClick: () => goTo(flow.step - 1) }
    : null
  const navForward = (() => {
    if (flow.step >= STEPS.length - 1) return null
    const label = STEPS[flow.step + 1]
    if (flow.step === 0) {
      const canAdvance = recording.uploadStatus === 'ready' || (!!flow.flowId && recording.uploadStatus === 'idle')
      return { label, onClick: handleRecordContinue, disabled: !canAdvance }
    }
    return {
      label,
      onClick: () => goTo(flow.step + 1),
      disabled: stepStates[flow.step + 1] === 'locked',
    }
  })()

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
      <div className="flex flex-1 flex-col overflow-y-auto p-[25px]">
        {flow.step === 0 && <RecordStep recording={recording} />}
        {flow.step === 1 && <PostprocessStep />}
        {flow.step === 2 && <SaveStep />}
      </div>
      <FlowFooter navBack={navBack} navForward={navForward} />
    </div>
  )
}
