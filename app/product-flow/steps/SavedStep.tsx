'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useProductFlow } from '@/app/contexts/ProductFlowContext'

export default function SavedStep() {
  const flow = useProductFlow()
  const router = useRouter()

  useEffect(() => {
    const t = setTimeout(() => {
      flow.reset()
      router.push('/dashboard')
    }, 1000)
    return () => clearTimeout(t)
  }, [flow, router])

  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <p className="text-sm text-muted">Saved successfully</p>
    </div>
  )
}
