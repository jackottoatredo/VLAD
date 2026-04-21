'use client'

import { useRef } from 'react'
import { useProductFlow, type ProductFlowStep } from '@/app/contexts/ProductFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import FlowStepper from '@/app/components/FlowStepper'
import PageLayout from '@/app/components/PageLayout'
import RecordStep from '@/app/product-flow/steps/RecordStep'
import PostprocessStep from '@/app/product-flow/steps/PostprocessStep'
import PreviewStep from '@/app/product-flow/steps/PreviewStep'
import SavedStep from '@/app/product-flow/steps/SavedStep'

const STEPS = ['Record', 'Postprocess', 'Preview', 'Saved']

export default function ProductFlowWizard() {
  const { presenter } = useUser()
  const flow = useProductFlow()
  const recording = useRecording({
    webcamMode: flow.webcamSettings.webcamMode,
  })

  // Track the highest step the user has reached (so they can go back and forward within visited steps)
  const maxStepRef = useRef(flow.step)
  if (flow.step > maxStepRef.current) maxStepRef.current = flow.step
  // Once the user has confirmed a recording (reached Postprocess), both Postprocess
  // and Preview are always reachable — free navigation between them even while eager
  // preview jobs are still rendering.
  if (flow.step >= 1 && maxStepRef.current < 2) maxStepRef.current = 2

  const goTo = (s: number) => {
    if (s >= 0 && s <= maxStepRef.current) flow.setStep(s as ProductFlowStep)
  }

  const canGoForward = flow.step < maxStepRef.current

  const navBack = flow.step > 0
    ? { label: STEPS[flow.step - 1], onClick: () => goTo(flow.step - 1) }
    : null
  const navForward = flow.step < STEPS.length - 2
    ? { label: STEPS[flow.step + 1], onClick: () => goTo(flow.step + 1), disabled: !canGoForward }
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
        <FlowStepper steps={STEPS} currentStep={flow.step} maxReachableStep={maxStepRef.current} onStepClick={goTo} />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {flow.step === 0 && <RecordStep recording={recording} navForward={navForward} />}
        {flow.step === 1 && <PostprocessStep navBack={navBack} navForward={navForward} />}
        {flow.step === 2 && <PreviewStep navBack={navBack} navForward={navForward} />}
        {flow.step === 3 && <SavedStep />}
      </div>
    </div>
  )
}
