"use client";

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Footer() {
  const pathname = usePathname()

  // Public share pages are for external recipients; suppress internal links.
  if (pathname === '/video-demos' || pathname?.startsWith('/video-demos/')) return null

  // Scrollable pages render the footer in-flow below the content instead of
  // fixed so it doesn't overlay long content.
  const inFlowPaths = ['/docs', '/tools/engagement', '/tools/usage']
  const isInFlow = inFlowPaths.some((p) => pathname === p || pathname?.startsWith(`${p}/`))

  const linkClass = 'text-muted hover:text-foreground transition-colors'
  const separatorClass = 'text-border'
  const positionClass = isInFlow
    ? 'mt-auto self-end mr-4 mb-2'
    : 'fixed bottom-2 right-4 z-40'

  return (
    <footer className={`${positionClass} flex items-center gap-2 text-[0.65625rem]`}>
      <Link href="/feature-request" className={linkClass}>
        Request a feature
      </Link>
      <span className={separatorClass}>|</span>
      <Link href="/bug-report" className={linkClass}>
        Report a bug
      </Link>
      <span className={separatorClass}>|</span>
      <Link href="/docs" className={linkClass}>
        Docs
      </Link>
      <span className={separatorClass}>|</span>
      <a
        href="https://redo-tech.slack.com/archives/C0AU9L8FHNJ"
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        Slack
      </a>
    </footer>
  )
}
