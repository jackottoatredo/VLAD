'use client'

import { useState } from 'react'
import Page from '@/app/components/Page'

export default function BugReportPage() {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const canSubmit = text.trim().length > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Request failed (${response.status})`)
      }
      setText('')
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page maxWidth="800px">
      <main className="flex h-full w-full flex-col space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Report a bug
          </h1>
          <p className="mt-1 text-sm text-muted">
            Describe what went wrong. Reports are posted to the{' '}
            <a
              href="https://redo-tech.slack.com/archives/C0AU9L8FHNJ/p1776788407647019"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              bugs thread in Slack
            </a>
            .
          </p>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => { setText(e.target.value); setSubmitted(false) }}
          placeholder="Describe what went wrong…"
          rows={8}
          className="block w-full resize-y rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-black px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-inner outline-none focus:border-gray-400 dark:focus:border-gray-500"
        />

        {error && <p className="text-xs text-red-500">{error}</p>}
        {submitted && !error && (
          <p className="text-xs text-foreground">Bug report submitted. Thanks!</p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </main>
    </Page>
  )
}
