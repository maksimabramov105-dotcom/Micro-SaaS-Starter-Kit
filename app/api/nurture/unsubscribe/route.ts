/**
 * GET /api/nurture/unsubscribe?token= — one-click lead unsubscribe (C4).
 * Verifies the email-HMAC token, adds the address to the GLOBAL suppression
 * list, and stops every nurture sequence for it. No login required.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { suppressEmail } from '@/lib/nurture'
import { verifyLeadUnsubscribeToken } from '@/lib/nurture/token'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  const email = verifyLeadUnsubscribeToken(token)
  if (!email) {
    return NextResponse.json({ error: 'Invalid unsubscribe link.' }, { status: 400 })
  }
  await suppressEmail(email, 'unsubscribe')
  return NextResponse.redirect(`${APP_URL}/unsubscribed`, 303)
}
