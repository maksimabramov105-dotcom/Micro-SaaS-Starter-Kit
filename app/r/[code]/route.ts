/**
 * app/r/[code]/route.ts
 *
 * Referral landing Route Handler.
 * GET /r/{code}  →  sets a 30-day `referral_code` cookie and redirects to /
 *
 * Using a Route Handler (not page.tsx) because cookies().set() is only
 * allowed in Route Handlers, Server Actions, and Middleware — not in
 * Server Components.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { REFERRAL_COOKIE } from '@/lib/referral'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params

  // Validate the code exists (no revealing whether it does or doesn't beyond a redirect)
  const referrer = await prisma.user.findFirst({
    where: { referralCode: code },
    select: { id: true },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const destination = referrer
    ? `${appUrl}/login?ref=${encodeURIComponent(code)}`
    : `${appUrl}/`

  const response = NextResponse.redirect(destination)

  if (referrer) {
    // httpOnly: false per spec (prompt rule: Tolt cookie window must match — JS-readable)
    response.cookies.set(REFERRAL_COOKIE, code, {
      maxAge: 60 * 60 * 24 * 30,  // 30 days
      sameSite: 'lax',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
  }

  return response
}
