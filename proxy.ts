/**
 * proxy.ts  (Next.js 16 — Node.js runtime, replaces old middleware.ts)
 *
 * Responsibilities:
 *  1. Auth guard — redirect unauthenticated requests to /login for /dashboard/*
 *  2. Anon cookie — seed `rai_anon` cookie for experiment tracking on page routes
 *
 * The cookie is set before any SSR runs, so `lib/experiments.ts` can read it
 * from the very first page load without needing cookies().set() in a Server Component.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

// Keep in sync with ANON_COOKIE in lib/experiments.ts
const ANON_COOKIE = 'rai_anon'

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Auth guard: /dashboard/* ─────────────────────────────────────────────
  if (pathname.startsWith('/dashboard')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      const signIn = new URL('/login', req.url)
      signIn.searchParams.set('callbackUrl', req.url)
      return NextResponse.redirect(signIn)
    }
  }

  const response = NextResponse.next()

  // ── Seed anon cookie (all page routes, skip if already present) ───────────
  // crypto.randomUUID() is a Web Crypto API method — available in Node.js 16+
  if (!req.cookies.get(ANON_COOKIE)) {
    response.cookies.set(ANON_COOKIE, crypto.randomUUID(), {
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
  // Run on all page routes; skip API routes, static files, Next.js internals
  matcher: ['/((?!api/|_next/static|_next/image|favicon\\.ico|robots\\.txt).*)'],
}
