'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { GoogleIcon } from '@/app/components/icons'

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'You need a @redo.com or @getredo.com email to sign in.',
  OAuthSignin: 'Could not start Google sign-in. Try again.',
  OAuthCallback: 'Google sign-in was interrupted. Try again.',
  Callback: 'Sign-in failed. Try again.',
  Default: 'Something went wrong. Try again.',
}

function LoginCard() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'
  const errorCode = searchParams.get('error')
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default
    : null

  const [submitting, setSubmitting] = useState(false)

  return (
    <main className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-surface p-8 shadow-md">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Welcome to VLAD
        </h1>
        <p className="text-sm text-muted">
          Login with your{' '}
          <span className="font-medium text-foreground">@redo.com</span> email
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-foreground"
        >
          {errorMessage}
        </div>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={() => {
          setSubmitting(true)
          signIn('google', { callbackUrl })
        }}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:border-muted hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleIcon className="h-5 w-5" />
        {submitting ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <p className="text-center text-[0.65625rem] text-muted">
        Only @redo.com and @getredo.com accounts are allowed.
      </p>
    </main>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
      <Suspense fallback={null}>
        <LoginCard />
      </Suspense>
    </div>
  )
}

