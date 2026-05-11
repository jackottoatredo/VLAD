'use client'

import { APP_ENV, PROD_URL, BETA_URL } from '@/app/config'
import PageLarge from '@/app/components/PageLarge'

type Link = { href: string; title: string; description: string; external?: boolean }

export default function QuickLinksPage() {
  const links: Link[] = [
    {
      href: 'https://redo-tech.slack.com/archives/C0AU9L8FHNJ',
      title: 'Slack',
      description: 'Join the VLAD channel for support and announcements.',
      external: true,
    },
  ]

  if (APP_ENV === 'prod') {
    links.push({
      href: BETA_URL,
      title: 'Try beta',
      description: 'Switch to the beta environment to preview unreleased features.',
    })
  } else if (APP_ENV === 'beta') {
    links.push({
      href: PROD_URL,
      title: 'Exit beta',
      description: 'Switch back to the production environment.',
    })
  } else if (APP_ENV === 'dev') {
    links.push(
      {
        href: PROD_URL,
        title: 'Prod',
        description: 'Switch to the production environment.',
      },
      {
        href: BETA_URL,
        title: 'Beta',
        description: 'Switch to the beta environment.',
      },
    )
  }

  return (
    <PageLarge maxWidth="800px">
      <main className="flex h-full w-full flex-col space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Quick Links
          </h1>
          <p className="mt-1 text-sm text-muted">
            Shortcuts to Slack and other environments.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {links.map((link) => (
            <a
              key={link.title}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className="flex flex-col gap-2 rounded-xl border border-border bg-background p-5 transition hover:border-muted hover:shadow-sm"
            >
              <h3 className="font-medium text-foreground">{link.title}</h3>
              <p className="text-xs text-muted">{link.description}</p>
            </a>
          ))}
        </div>
      </main>
    </PageLarge>
  )
}
