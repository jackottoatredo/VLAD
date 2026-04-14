'use client'

import PageLayout from '@/app/components/PageLayout'
import PageNav from '@/app/components/PageNav'

export default function ReviewPage() {
  return (
    <>
      <PageLayout
        instructions={<p>Select a saved product recording and a saved merchant recording, then kick off a final render that composites both into a single video.</p>}
        settings={null}
      >
        <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 dark:border-zinc-700">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300">Coming Soon</h2>
            <p className="text-sm text-zinc-500">The final rendering pipeline is under construction.</p>
          </div>
        </div>
      </PageLayout>
      <PageNav back={{ label: 'Merchant Postprocessing', href: '/merchant-postprocess' }} />
    </>
  )
}
