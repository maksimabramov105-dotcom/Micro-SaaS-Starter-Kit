'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

// Human-readable descriptions for NextAuth error codes that land on this page
// via pages.error: '/login' in authOptions.
const AUTH_ERRORS: Record<string, string> = {
  OAuthSignin: 'Could not start the sign-in process. Please try again.',
  OAuthCallback: 'Something went wrong during sign-in. Please try again.',
  OAuthCreateAccount: 'Could not create your account. Please try again.',
  EmailCreateAccount: 'Could not create your account. Please try again.',
  Callback: 'Sign-in callback error. Please try again.',
  OAuthAccountNotLinked:
    'We had trouble linking that account. Please click your provider again — your accounts will be connected automatically.',
  EmailSignin: 'Failed to send the sign-in email. Please try again.',
  CredentialsSignin: 'Invalid credentials. Please check and try again.',
  SessionRequired: 'You must be signed in to access that page.',
  Default: 'An error occurred during sign-in. Please try again.',
}

// Reads ?callbackUrl= from the URL so users coming from a protected deep-link
// (e.g. /dashboard/resumes/123 → redirected here by proxy.ts) land back where
// they started after sign-in instead of always going to /dashboard.
// Errors that auto-resolve on a second attempt (account-linking + transient OAuth
// state). We auto-retry the SAME provider once so users never see them.
const RETRYABLE = new Set(['OAuthAccountNotLinked', 'OAuthCallback', 'Callback', 'OAuthSignin'])

// Provider memory + one-shot retry guard.
// sessionStorage alone silently broke the auto-retry in Safari Lockdown Mode and
// partitioned-storage privacy modes — the transient OAuth error then surfaced to
// the user. A short-lived cookie is now the primary store (survives Lockdown
// Mode), with sessionStorage as a backup, so the auto-retry fires in every
// browser and the flake stays invisible.
const PROVIDER_KEY = 'li_last_provider'
const RETRIED_KEY = 'li_autoretried'
function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}
function writeCookie(name: string, value: string, maxAge = 300) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`
  } catch {
    /* ignore */
  }
}
function rememberProvider(provider: string) {
  writeCookie(PROVIDER_KEY, provider)
  try { sessionStorage.setItem(PROVIDER_KEY, provider) } catch { /* ignore */ }
}
function recallProvider(): string | null {
  const fromCookie = readCookie(PROVIDER_KEY)
  if (fromCookie) return fromCookie
  try { return sessionStorage.getItem(PROVIDER_KEY) } catch { return null }
}
function markRetried() {
  writeCookie(RETRIED_KEY, '1')
  try { sessionStorage.setItem(RETRIED_KEY, '1') } catch { /* ignore */ }
}
function hasRetried(): boolean {
  if (readCookie(RETRIED_KEY) === '1') return true
  try { return sessionStorage.getItem(RETRIED_KEY) === '1' } catch { return false }
}
function clearRetried() {
  writeCookie(RETRIED_KEY, '', 0)
  try { sessionStorage.removeItem(RETRIED_KEY) } catch { /* ignore */ }
}

function LoginButtons() {
  const searchParams = useSearchParams()

  // proxy.ts always sends a relative path as callbackUrl (e.g. /dashboard/resumes/123).
  // Only accept relative paths to prevent open-redirect attacks.
  const raw = searchParams.get('callbackUrl') ?? '/dashboard'
  const callbackUrl = raw.startsWith('/') ? raw : '/dashboard'

  const errorCode = searchParams.get('error')
  const errorMessage = errorCode
    ? (AUTH_ERRORS[errorCode] ?? AUTH_ERRORS['Default'])
    : null

  const [retrying, setRetrying] = useState(false)
  const didRetry = useRef(false)

  // Remember which provider was used, then kick off sign-in.
  const go = (provider: 'google' | 'github') => {
    rememberProvider(provider)
    signIn(provider, { callbackUrl })
  }

  // Auto-retry ONCE on a retryable error so a flaked first attempt is invisible.
  // Guarded by sessionStorage so it can never loop: if the retry also fails, we
  // fall through to the manual buttons.
  useEffect(() => {
    if (!errorCode) {
      clearRetried()
      return
    }
    if (!RETRYABLE.has(errorCode) || didRetry.current) return
    if (hasRetried()) return
    const lastProvider = recallProvider()
    if (lastProvider !== 'google' && lastProvider !== 'github') return
    didRetry.current = true
    markRetried()
    setRetrying(true)
    signIn(lastProvider, { callbackUrl })
  }, [errorCode, callbackUrl])

  if (retrying) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-slate-600" role="status">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
        Signing you in…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div
          role="alert"
          data-testid="signin-error"
          className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
        >
          <p className="font-medium">{errorMessage}</p>
          <p className="mt-1 text-amber-700">
            This usually works on the second try — just click your provider again below.
          </p>
        </div>
      )}
      <Button
        variant="outline"
        className="w-full"
        data-testid="signin-google"
        onClick={() => go('google')}
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </Button>
      <Button
        variant="outline"
        className="w-full"
        data-testid="signin-github"
        onClick={() => go('github')}
      >
        <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
        Continue with GitHub
      </Button>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Sign in or create your account</CardTitle>
          <CardDescription className="text-center">
            New here? Continuing with Google or GitHub creates your account instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Suspense required because useSearchParams() opts into dynamic rendering */}
          <Suspense fallback={
            <div className="space-y-3">
              <Button variant="outline" className="w-full" disabled>Continue with Google</Button>
              <Button variant="outline" className="w-full" disabled>Continue with GitHub</Button>
            </div>
          }>
            <LoginButtons />
          </Suspense>
          <div className="text-center text-sm text-gray-500">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
