import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { supabase } from '@/lib/db/supabase'
import { encodeFiltersForApi, type AdminFilters } from '@/app/tools/_components/filters'

type Tool = {
  href: string
  title: string
  description: string
}

// Build the engagement card href. For non-admins we pre-apply an
// include-presenter chip set to themselves so the page opens scoped to
// their own shares by default. They can remove the chip in the filters
// modal — this is purely a default, not a security boundary.
async function engagementHref(
  email: string,
  isAdmin: boolean,
): Promise<string> {
  if (isAdmin) return '/tools/engagement'
  const { data } = await supabase
    .from('vlad_users')
    .select('first_name, last_name')
    .eq('id', email)
    .single()
  const display =
    `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim() || email
  const filters: AdminFilters = {
    include: [{ kind: 'presenter', value: email, label: display }],
    exclude: [],
  }
  const encoded = encodeFiltersForApi(filters)
  return encoded
    ? `/tools/engagement?filters=${encodeURIComponent(encoded)}`
    : '/tools/engagement'
}

export default async function ToolsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/')

  const isAdmin = session.user.role === 'admin'
  const engagement = await engagementHref(session.user.email, isAdmin)

  const tools: Tool[] = [
    {
      href: engagement,
      title: 'Engagement Statistics',
      description: 'See how leads are interacting with shared demo pages.',
    },
    {
      href: '/tools/settings',
      title: 'Settings & Notifications',
      description: 'Configure your HubSpot booking link and other share-page preferences.',
    },
  ]
  if (isAdmin) {
    tools.push(
      {
        href: '/tools/recordings',
        title: 'Manage Recordings',
        description: "Browse and manage every user's recordings.",
      },
      {
        href: '/tools/usage',
        title: 'Usage Statistics',
        description: 'Track recording volume and render activity across users.',
      },
    )
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Tools
            </h1>
            <h3 className="mt-1 text-muted">
              {isAdmin
                ? 'Engagement, settings, and admin-only recording / usage tooling.'
                : 'Track engagement on your shared demos.'}
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 !mt-2">
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
          <Link href="/" className="text-muted hover:text-foreground">
            ← Home
          </Link>
        </div>
      </main>
    </div>
  )
}
