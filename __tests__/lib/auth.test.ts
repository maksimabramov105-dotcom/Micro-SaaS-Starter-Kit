/**
 * Regression tests for lib/auth.ts
 *
 * These tests guard against the sign-in redirect loop caused by an unhandled
 * Prisma error inside the session callback.  If getServerSession() throws (or
 * returns null), dashboard/layout.tsx redirects back to /login, creating an
 * infinite loop for any user whose DB row can't be fetched.
 *
 * Critical invariant: session.user.id MUST always be set from token.sub,
 * regardless of whether the Prisma lookup succeeds or fails.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))

// Mint handle + referral are not under test here
jest.mock('@/lib/auth/handle-mint', () => ({
  mintInboxHandle: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/referral', () => ({
  captureReferral: jest.fn().mockResolvedValue(undefined),
  REFERRAL_COOKIE: 'referral_code',
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined),
  }),
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Session } from 'next-auth'
import type { JWT } from 'next-auth/jwt'

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock }
}

// Helper to call the session callback directly (avoids full NextAuth machinery)
async function callSessionCallback(
  session: Session,
  token: Partial<JWT>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Session> {
  const cb = authOptions.callbacks?.session
  if (!cb) throw new Error('session callback not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (cb as any)({
    session,
    token: token as JWT,
    user: {} as never,
    newSession: undefined,
    trigger: 'update',
  })
  return result as Session
}

// Helper to call the redirect callback directly
async function callRedirectCallback(url: string, baseUrl: string): Promise<string> {
  const cb = authOptions.callbacks?.redirect
  if (!cb) throw new Error('redirect callback not configured')
  return cb({ url, baseUrl })
}

// ── Session callback tests ─────────────────────────────────────────────────────

describe('authOptions.callbacks.session', () => {
  // Factory: always return a fresh deep copy so mutations in one test
  // don't bleed into the next (session callback mutates session.user in-place).
  const makeSession = (): Session => JSON.parse(JSON.stringify({
    user: { id: '', name: 'Test User', email: 'test@example.com' },
    expires: new Date(Date.now() + 86400_000).toISOString(),
  })) as Session
  const TOKEN: JWT = { sub: 'user-abc-123' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sets session.user.id from token.sub when DB lookup succeeds', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      stripePriceId: 'price_test',
      stripeCurrentPeriodEnd: null,
      firstPaidAt: null,
      refundedAt: null,
      role: 'user',
    })

    const session = await callSessionCallback(makeSession(), TOKEN)

    expect(session.user.id).toBe('user-abc-123')
    expect(session.user.stripeCustomerId).toBe('cus_test')
    expect(session.user.role).toBe('user')
  })

  it('still sets session.user.id even when Prisma throws — no redirect loop', async () => {
    // This is the regression case: Prisma is unavailable or the row is corrupted.
    // The session callback must NOT throw — getServerSession() must return a
    // non-null session so the user isn't bounced back to /login.
    mockPrisma.user.findUnique.mockRejectedValue(new Error('Database connection refused'))

    const session = await callSessionCallback(makeSession(), TOKEN)

    expect(session.user.id).toBe('user-abc-123')
    // Stripe fields should remain unset — that's acceptable; the user is still authenticated
    expect(session.user.stripeCustomerId).toBeUndefined()
  })

  it('still sets session.user.id when Prisma returns null (user row missing)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const session = await callSessionCallback(makeSession(), TOKEN)

    expect(session.user.id).toBe('user-abc-123')
  })

  it('returns session with no id set when token.sub is missing', async () => {
    const session = await callSessionCallback(makeSession(), {})
    // token.sub is absent → the callback skips the entire augmentation block,
    // so id stays at its initial empty-string value.
    expect(session.user.id).toBeFalsy()
    // Prisma should not be called without a user ID
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})

// ── Redirect callback tests ────────────────────────────────────────────────────

describe('authOptions.callbacks.redirect', () => {
  const BASE_URL = 'https://example.com'

  it('allows relative URLs (same-origin deep links)', async () => {
    const result = await callRedirectCallback('/dashboard/resumes/123', BASE_URL)
    expect(result).toBe('https://example.com/dashboard/resumes/123')
  })

  it('allows absolute URLs that start with baseUrl', async () => {
    const result = await callRedirectCallback('https://example.com/dashboard', BASE_URL)
    expect(result).toBe('https://example.com/dashboard')
  })

  it('falls back to /dashboard for external URLs (open-redirect guard)', async () => {
    const result = await callRedirectCallback('https://evil.com/steal', BASE_URL)
    expect(result).toBe('https://example.com/dashboard')
  })

  it('keeps protocol-relative URLs on the same origin (safe — browser prefixes current origin)', async () => {
    // "//evil.com" starts with "/" so the callback prepends baseUrl, producing
    // "https://example.com//evil.com" — the browser stays on example.com.
    const result = await callRedirectCallback('//evil.com', BASE_URL)
    expect(result).toBe('https://example.com//evil.com')
  })
})
