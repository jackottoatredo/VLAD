'use client'

import { ProductFlowContextProvider } from '@/app/contexts/ProductFlowContext'
import ProductFlowWizard from '@/app/product-flow/ProductFlowWizard'

export default function ProductFlowPage() {
  return (
    <ProductFlowContextProvider>
      <ProductFlowWizard />
    </ProductFlowContextProvider>
  )
}
