import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'

const tools = [
  {
    href: '/admin/recordings',
    title: 'Manage Recordings',
    description: "Browse and manage every user's recordings.",
  },
  {
    href: '/admin/usage',
    title: 'Usage Statistics',
    description: 'Track recording volume and render activity across users.',
  },
  {
    href: '/admin/engagement',
    title: 'Engagement Stats',
    description: 'See how leads are interacting with shared demo pages.',
  },
]

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  if (session?.user?.role !== 'admin') redirect('/')

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Admin Tools
            </h1>
            <h3 className="mt-1 text-muted">
              Manage other users&apos; recordings and review usage and engagement statistics.
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 !mt-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 transition hover:border-muted hover:shadow-sm"
            >
              <h3 className="font-medium text-foreground">{tool.title}</h3>
              <p className="text-xs text-muted">{tool.description}</p>
            </Link>
          ))}
        </div>

        <div className="flex justify-start !mt-1 -mb-5 text-xs text-foreground">
          <Link
            href="/"
            className="text-muted hover:text-foreground"
          >
            ← Home
          </Link>
        </div>
      </main>
    </div>
  )
}
