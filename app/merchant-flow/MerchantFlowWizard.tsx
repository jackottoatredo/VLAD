'use client'

import { useRef } from 'react'
import { useMerchantFlow, type MerchantFlowStep } from '@/app/contexts/MerchantFlowContext'
import { useUser } from '@/app/contexts/UserContext'
import { useRecording } from '@/app/hooks/useRecording'
import FlowStepper from '@/app/components/FlowStepper'
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
    onSaved: () => {
      flow.clearResults()
      maxStepRef.current = 1
      flow.setStep(1)
    },
  })

  const maxStepRef = useRef(flow.step)
  if (flow.step > maxStepRef.current) maxStepRef.current = flow.step

  const goTo = (s: number) => {
    if (s >= 0 && s <= maxStepRef.current) flow.setStep(s as MerchantFlowStep)
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
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {flow.step === 0 && <RecordStep recording={recording} navForward={navForward} />}
        {flow.step === 1 && <PostprocessStep navBack={navBack} navForward={navForward} />}
        {flow.step === 2 && <SavedStep />}
      </div>
    </div>
  )
}
