/**
 * middleware.ts
 *
 * Seeds the `rai_anon` cookie for anonymous visitors so that experiment
 * assignments in lib/experiments.ts are stable before the user signs up.
 *
 * Runs on every non-static, non-API route. Keeps the cookie for 1 year.
 * After signup, experiments.ts maps anonId → userId via the normal
 * ExperimentAssignment lookup (userId takes precedence once the user logs in).
 */

import { NextRequest, NextResponse } from 'next/server'

// !! Keep in sync with ANON_COOKIE in lib/experiments.ts !!
// Cannot import from experiments.ts here — it uses next/headers (Node.js only).
const ANON_COOKIE = 'rai_anon'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Only seed the cookie if it's missing — never overwrite an existing one.
  // crypto.randomUUID() is part of the Web Crypto API — available in Edge runtime.
  if (!request.cookies.get(ANON_COOKIE)) {
    const anonId = crypto.randomUUID()
    response.cookies.set(ANON_COOKIE, anonId, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  return response
}

export const config = {
  // Run on page routes only — skip API, static files, Next internals
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
}
