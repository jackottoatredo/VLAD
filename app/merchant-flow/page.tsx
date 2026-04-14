'use client'

import { MerchantFlowContextProvider } from '@/app/contexts/MerchantFlowContext'
import MerchantFlowWizard from '@/app/merchant-flow/MerchantFlowWizard'

export default function MerchantFlowPage() {
  return (
    <MerchantFlowContextProvider>
      <MerchantFlowWizard />
    </MerchantFlowContextProvider>
  )
}
