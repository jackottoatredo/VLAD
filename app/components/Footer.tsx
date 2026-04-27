"use client";

import Link from 'next/link'
import { useState } from 'react'
import BugReportModal from './BugReportModal'
import FeatureRequestModal from './FeatureRequestModal'

export default function Footer() {
  const [bugOpen, setBugOpen] = useState(false)
  const [featureOpen, setFeatureOpen] = useState(false)

  const linkClass = 'text-muted hover:text-foreground transition-colors'
  const separatorClass = 'text-border'

  return (
    <>
      <footer className="fixed bottom-2 right-4 z-40 flex items-center gap-2 text-[0.65625rem]">
        <button
          type="button"
          onClick={() => setFeatureOpen(true)}
          className={linkClass}
        >
          Request a feature
        </button>
        <span className={separatorClass}>|</span>
        <button
          type="button"
          onClick={() => setBugOpen(true)}
          className={linkClass}
        >
          Report a bug
        </button>
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

      {bugOpen && <BugReportModal onClose={() => setBugOpen(false)} />}
      {featureOpen && <FeatureRequestModal onClose={() => setFeatureOpen(false)} />}
    </>
  )
}
