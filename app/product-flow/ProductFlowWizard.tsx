'use client'

import { useEffect, useMemo } from 'react'
import { useProductFlow, type ProductFlowStep } from '@/app/contexts/ProductFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import { useNavigationGuard, type GuardPrompt } from '@/app/contexts/NavigationGuardContext'
import FlowStepper, { type StepState } from '@/app/components/FlowStepper'
import FlowFooter from '@/app/components/FlowFooter'
import PageLayout from '@/app/components/PageLayout'
import RecordStep from '@/app/product-flow/steps/RecordStep'
import PostprocessStep from '@/app/product-flow/steps/PostprocessStep'
import PreviewStep from '@/app/product-flow/steps/PreviewStep'
import SaveStep from '@/app/product-flow/steps/SaveStep'
import { EAGER_PREVIEW_RENDERING, PREVIEW_BRANDS, TARGET_URL } from '@/app/config'
import { slugifyPart } from '@/lib/naming'

const STEPS = ['Record', 'Postprocess', 'Preview', 'Save']

// Recover the original optional-tag from a saved name like
// `{prefix}-{tag}-{count}` so reopened flows can pre-fill the modal.
function extractTagFromName(name: string | null | undefined, prefix: string): string {
  if (!name || !prefix || !name.startsWith(`${prefix}-`)) return ''
  return name.slice(prefix.length + 1).replace(/-(\d+)$/, '')
}

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
      const prefix = slugifyPart(flow.product)
      if (!prefix) return null
      const defaultTag = extractTagFromName(flow.name, prefix)
      return {
        flowLabel: 'product flow',
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
                type: 'product',
                productName: flow.product,
                previewVideoR2Key: flow.postprocessVideoR2Key,
                webcamSettings: flow.webcamSettings,
                metadata: { trimStartSec: flow.trimStartSec, trimEndSec: flow.trimEndSec },
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
    flow.setStep(s as ProductFlowStep)
  }

  // Advance from Record → Postprocess. Commits the pending take (or just
  // advances if already committed) and kicks off the eager preview chain.
  function handleRecordContinue() {
    if (!presenter || !flow.product) return
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
      if (!EAGER_PREVIEW_RENDERING) return

      const product = flow.product
      const brandlessUrl = `${TARGET_URL}?product=${encodeURIComponent(product)}`
      const common = {
        flowId,
        presenter, product,
        webcamMode: flow.webcamSettings.webcamMode,
        webcamVertical: flow.webcamSettings.webcamVertical,
        webcamHorizontal: flow.webcamSettings.webcamHorizontal,
        preview: true as const,
      }

      const postRender = (url: string, priority: number) =>
        fetch('/api/produce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...common, url, priority }),
        })
          .then((r) => r.json() as Promise<{ jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }>)
          .catch(() => ({} as { jobId?: string; videoUrl?: string; videoR2Key?: string; error?: string }))

      const [brandless, ...branded] = await Promise.all([
        postRender(brandlessUrl, 1),
        ...PREVIEW_BRANDS.map((b) => postRender(`${brandlessUrl}&brand=${encodeURIComponent(b)}`, 2)),
      ])

      if (brandless.videoUrl) flow.setPostprocessVideoUrl(brandless.videoUrl, brandless.videoR2Key)
      else if (brandless.jobId) flow.setPostprocessJobId(brandless.jobId)

      PREVIEW_BRANDS.forEach((brand, i) => {
        const res = branded[i]
        if (res?.videoUrl) flow.setBrandVideoUrl(brand, res.videoUrl)
        else if (res?.jobId) flow.setBrandJobId(brand, res.jobId)
      })
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
        {flow.step === 2 && <PreviewStep />}
        {flow.step === 3 && <SaveStep />}
      </div>
      <FlowFooter navBack={navBack} navForward={navForward} />
    </div>
  )
}
