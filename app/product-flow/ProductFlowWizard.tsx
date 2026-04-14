'use client'

import { useRef } from 'react'
import { useProductFlow, type ProductFlowStep } from '@/app/contexts/ProductFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import FlowStepper from '@/app/components/FlowStepper'
import FlowNavigation from '@/app/components/FlowNavigation'
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
    onSaved: () => {
      flow.clearResults()
      maxStepRef.current = 2
      flow.setStep(1)
    },
  })

  // Track the highest step the user has reached (so they can go back and forward within visited steps)
  const maxStepRef = useRef(flow.step)
  if (flow.step > maxStepRef.current) maxStepRef.current = flow.step

  const goTo = (s: number) => {
    if (s >= 0 && s <= maxStepRef.current) flow.setStep(s as ProductFlowStep)
  }

  const canGoForward = flow.step < maxStepRef.current

  if (!presenter) {
    return (
      <PageLayout instructions={<p>Select a presenter on the home page first.</p>} settings={null}>
        <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 dark:border-zinc-700">
          <p className="text-sm text-zinc-500">No presenter selected</p>
        </div>
      </PageLayout>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <FlowStepper steps={STEPS} currentStep={flow.step} maxReachableStep={maxStepRef.current} onStepClick={goTo} />
      </div>
      <FlowNavigation
        steps={STEPS}
        currentStep={flow.step}
        canGoForward={canGoForward}
        onBack={() => goTo(flow.step - 1)}
        onForward={() => goTo(flow.step + 1)}
      />
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div style={{ display: flow.step === 0 ? 'contents' : 'none' }}>
          <RecordStep recording={recording} />
        </div>
        {flow.step === 1 && <PostprocessStep />}
        {flow.step === 2 && <PreviewStep />}
        {flow.step === 3 && <SavedStep />}
      </div>
    </div>
  )
}
