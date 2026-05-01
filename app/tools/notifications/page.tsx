import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <main className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Notifications
          </h1>
          <h3 className="mt-1 text-muted">
            Get pinged when a lead engages with your share. Coming soon.
          </h3>
        </div>
        <div className="flex justify-start text-xs text-foreground">
          <Link href="/tools" className="text-muted hover:text-foreground">
            ← Tools
          </Link>
        </div>
      </main>
    </div>
  )
}
