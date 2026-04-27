'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'You need a @redo.com or @getredo.com email to sign in.',
  OAuthSignin: 'Could not start Google sign-in. Try again.',
  OAuthCallback: 'Google sign-in was interrupted. Try again.',
  Callback: 'Sign-in failed. Try again.',
  Default: 'Something went wrong. Try again.',
}

function LoginCard() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'
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
        <GoogleIcon />
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

function GoogleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.55-.2-2.27H12v4.51h6.45a5.51 5.51 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.15 3.58-8.85z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.21 7.21 0 0 1 4.89 12c0-.79.14-1.56.38-2.29V6.6H1.29A12 12 0 0 0 0 12c0 1.94.46 3.78 1.29 5.4l3.98-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.6l3.98 3.11C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}
