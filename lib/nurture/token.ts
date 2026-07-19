/**
 * lib/nurture/token.ts — HMAC-signed, no-login unsubscribe tokens for LEADS
 * (email-keyed; the existing lib/notifications token is userId-keyed).
 * token = base64url(email) + "." + base64url(HMAC-SHA256(email, CRON_SECRET))
 */
import { createHmac, timingSafeEqual } from 'crypto'

function secret(): string {
  return process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET || 'dev-secret'
}

function hmac(email: string): Buffer {
  return createHmac('sha256', secret()).update(email.toLowerCase()).digest()
}

export function createLeadUnsubscribeToken(email: string): string {
  const e = Buffer.from(email.toLowerCase()).toString('base64url')
  return `${e}.${hmac(email).toString('base64url')}`
}

export function verifyLeadUnsubscribeToken(token: string): string | null {
  const [e, sig] = token.split('.')
  if (!e || !sig) return null
  try {
    const email = Buffer.from(e, 'base64url').toString()
    const expected = hmac(email)
    const got = Buffer.from(sig, 'base64url')
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
    return email
  } catch {
    return null
  }
}
