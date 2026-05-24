/**
 * Tests for lib/referral/index.ts
 *
 * All tests run without hitting Stripe or a real DB — everything is mocked.
 */

import {
  captureReferral,
  qualifyReferral,
  clawbackReferral,
  ensureReferralCode,
  MAX_REFERRALS,
  REFERRAL_CREDIT_CENTS,
} from '@/lib/referral'

// nanoid v5 is ESM-only; mock it for Jest (CommonJS environment)
jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'abc123',
}))

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    referral: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}))

// ── Mock Stripe ───────────────────────────────────────────────────────────────
jest.mock('@/lib/stripe', () => ({
  stripe: {
    coupons: { create: jest.fn(), del: jest.fn() },
    customers: { update: jest.fn() },
  },
}))

// ── Mock emails ───────────────────────────────────────────────────────────────
jest.mock('@/lib/referral/emails', () => ({
  sendReferralQualifiedEmail: jest.fn().mockResolvedValue(undefined),
  sendReferralReceivedEmail:  jest.fn().mockResolvedValue(undefined),
}))

const { prisma } = require('@/lib/prisma')
const { stripe } = require('@/lib/stripe')
const { sendReferralQualifiedEmail, sendReferralReceivedEmail } = require('@/lib/referral/emails')

function resetMocks() {
  // resetAllMocks clears both call history AND the mockResolvedValueOnce queue;
  // clearAllMocks only clears call history, leaving stale queued values.
  jest.resetAllMocks()
  // Re-wire $transaction after reset (reset removes the mock implementation)
  ;(prisma.$transaction as jest.Mock).mockImplementation(
    async (ops: (() => Promise<unknown>)[]) => {
      if (Array.isArray(ops)) return Promise.all(ops)
      return (ops as unknown as (p: typeof prisma) => Promise<unknown>)(prisma)
    },
  )
}

// ── captureReferral ───────────────────────────────────────────────────────────

describe('captureReferral', () => {
  beforeEach(resetMocks)

  it('creates a pending Referral row and links referredById on valid referral', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'referrer-1', email: 'alice@x.com', name: 'Alice' }) // referrer lookup
      .mockResolvedValueOnce(null) // no existing referral
    prisma.user.findUnique.mockResolvedValueOnce({ email: 'bob@x.com', name: 'Bob' }) // referee lookup

    prisma.referral.findFirst.mockResolvedValueOnce(null) // no existing referral

    prisma.referral.create.mockResolvedValueOnce({ id: 'ref-1' })
    prisma.user.update.mockResolvedValueOnce({})

    await captureReferral('referee-1', 'alice-abc123')

    expect(prisma.referral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referrerId: 'referrer-1', refereeId: 'referee-1', status: 'pending' }),
      }),
    )
    expect(sendReferralReceivedEmail).toHaveBeenCalledTimes(1)
  })

  it('rejects self-referral silently', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'same-user', email: 'x@x.com', name: 'X' })

    await captureReferral('same-user', 'some-code')

    expect(prisma.referral.create).not.toHaveBeenCalled()
  })

  it('no-ops when referral code does not exist', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null) // referrer not found

    await captureReferral('referee-1', 'nonexistent-code')

    expect(prisma.referral.create).not.toHaveBeenCalled()
  })

  it('no-ops when referee already has a referral', async () => {
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 'referrer-1', email: 'a@x.com', name: 'A' })
    prisma.referral.findFirst.mockResolvedValueOnce({ id: 'existing' }) // already exists

    await captureReferral('referee-1', 'alice-abc123')

    expect(prisma.referral.create).not.toHaveBeenCalled()
  })
})

// ── qualifyReferral ───────────────────────────────────────────────────────────

describe('qualifyReferral', () => {
  beforeEach(resetMocks)

  it('creates two coupons, applies them, marks rewarded, increments counters', async () => {
    prisma.referral.findFirst.mockResolvedValueOnce({
      id: 'ref-1',
      referrerId: 'referrer-1',
      refereeId: 'referee-1',
      status: 'pending',
      referrer: {
        id: 'referrer-1',
        email: 'alice@x.com',
        name: 'Alice',
        stripeCustomerId: 'cus_referrer',
        referralCount: 0,
      },
    })
    prisma.referral.update.mockResolvedValue({})
    prisma.user.update.mockResolvedValue({})
    stripe.coupons.create
      .mockResolvedValueOnce({ id: 'coupon-referrer' })
      .mockResolvedValueOnce({ id: 'coupon-referee' })
    stripe.customers.update.mockResolvedValue({})

    await qualifyReferral('referee-1', 'cus_referee')

    expect(stripe.coupons.create).toHaveBeenCalledTimes(2)
    expect(stripe.customers.update).toHaveBeenCalledWith('cus_referee', { coupon: 'coupon-referee' })
    expect(stripe.customers.update).toHaveBeenCalledWith('cus_referrer', { coupon: 'coupon-referrer' })
    expect(sendReferralQualifiedEmail).toHaveBeenCalledTimes(1)
    // Verify the rewarded update call
    expect(prisma.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rewarded' }),
      }),
    )
  })

  it('enforces the MAX_REFERRALS cap by marking status=abused', async () => {
    prisma.referral.findFirst.mockResolvedValueOnce({
      id: 'ref-cap',
      referrerId: 'referrer-1',
      refereeId: 'referee-cap',
      status: 'pending',
      referrer: {
        id: 'referrer-1',
        email: 'alice@x.com',
        name: 'Alice',
        stripeCustomerId: 'cus_referrer',
        referralCount: MAX_REFERRALS, // at cap
      },
    })
    prisma.referral.update.mockResolvedValue({})

    await qualifyReferral('referee-cap', 'cus_referee_cap')

    expect(stripe.coupons.create).not.toHaveBeenCalled()
    expect(prisma.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'abused' } }),
    )
  })

  it('no-ops when no pending referral found', async () => {
    prisma.referral.findFirst.mockResolvedValueOnce(null)

    await qualifyReferral('nobody', 'cus_nobody')

    expect(stripe.coupons.create).not.toHaveBeenCalled()
  })
})

// ── clawbackReferral ──────────────────────────────────────────────────────────

describe('clawbackReferral', () => {
  beforeEach(resetMocks)

  it('claws back within 30-day window: marks clawback, decrements counters, deletes coupon', async () => {
    const firstPaidAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'referee-1', firstPaidAt })
    prisma.referral.findFirst.mockResolvedValueOnce({
      id: 'ref-1',
      refereeId: 'referee-1',
      status: 'rewarded',
      stripeCouponReferrerId: 'coupon-referrer',
      referrer: { id: 'referrer-1', stripeCustomerId: 'cus_referrer' },
    })
    prisma.referral.update.mockResolvedValue({})
    prisma.user.update.mockResolvedValue({})
    stripe.coupons.del.mockResolvedValue({})

    await clawbackReferral('cus_referee')

    expect(prisma.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'clawback' } }),
    )
    expect(stripe.coupons.del).toHaveBeenCalledWith('coupon-referrer')
  })

  it('does NOT claw back when refund is outside the 30-day window', async () => {
    const firstPaidAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) // 35 days ago
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'referee-old', firstPaidAt })

    await clawbackReferral('cus_old_referee')

    expect(prisma.referral.findFirst).not.toHaveBeenCalled()
    expect(stripe.coupons.del).not.toHaveBeenCalled()
  })
})

// ── ensureReferralCode ────────────────────────────────────────────────────────

describe('ensureReferralCode', () => {
  beforeEach(resetMocks)

  it('returns existing code without writing to DB', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ referralCode: 'anna-7g9k23', name: 'Anna' })

    const code = await ensureReferralCode('user-1')

    expect(code).toBe('anna-7g9k23')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('generates and saves a new code when none exists', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ referralCode: null, name: 'Bob Smith' })
    prisma.user.update.mockResolvedValueOnce({})

    const code = await ensureReferralCode('user-2')

    expect(code).toMatch(/^bob-[a-z0-9]{6}$/)
    expect(prisma.user.update).toHaveBeenCalledTimes(1)
  })
})
