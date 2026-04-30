import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'

export default async function AdminEngagementPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Engagement Statistics
          </h1>
          <h3 className="mt-1 text-muted">Coming soon.</h3>
        </div>

        <div className="flex justify-start !mt-1 -mb-5 text-xs text-foreground">
          <Link href="/admin" className="text-muted hover:text-foreground">
            ← Admin tools
          </Link>
        </div>
      </main>
    </div>
  )
}
