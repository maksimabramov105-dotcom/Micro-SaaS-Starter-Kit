/**
 * lib/referral/index.ts
 *
 * In-house double-sided referral program.
 *
 * Rewards: $20 Stripe coupon for the referrer on the referee's first paid invoice;
 *          $20 Stripe coupon for the referee applied to their first subscription.
 *
 * Anti-abuse rules:
 *  - No self-referral
 *  - Max 10 rewarded referrals per user (= $200/yr cap — documented in T&C)
 *  - Abused status manually set when fraud detected — coupons not issued
 *  - Clawback if referee refunds within 30 days
 *
 * Coupon idempotency: Stripe idempotency key = "referral-{referralId}-{side}"
 */

import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { customAlphabet } from 'nanoid'
import { sendReferralQualifiedEmail, sendReferralReceivedEmail } from './emails'

// ── Constants ─────────────────────────────────────────────────────────────────

export const REFERRAL_CREDIT_CENTS = 2_000   // $20
export const MAX_REFERRALS = 10              // max rewarded referrals per user per lifetime
export const REFERRAL_COOKIE = 'referral_code'
export const CLAWBACK_WINDOW_DAYS = 30

// nanoid alphabet: lowercase letters without ambiguous chars (l, 1, 0, o, i)
const codeAlphabet = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 6)

// ── Code generation ───────────────────────────────────────────────────────────

/**
 * Return the user's referral code, creating one if absent.
 * Format: "{name-slug}-{6 random chars}", e.g. "anna-7g9k23"
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true, name: true },
  })
  if (!user) throw new Error(`User ${userId} not found`)
  if (user.referralCode) return user.referralCode

  // Build slug from display name (first word, lowercase, letters only)
  const namePart = user.name
    ? user.name
        .split(/\s+/)[0]
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .slice(0, 10)
    : 'user'

  // Retry up to 5 times on the off-chance of collision (extremely unlikely)
  for (let i = 0; i < 5; i++) {
    const code = `${namePart || 'user'}-${codeAlphabet()}`
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { referralCode: code },
      })
      return code
    } catch {
      // P2002 = unique constraint violation — try a new code
      continue
    }
  }

  throw new Error('Failed to generate unique referral code after 5 attempts')
}

// ── Capture on signup ─────────────────────────────────────────────────────────

/**
 * Called from lib/auth.ts `createUser` event when a referral_code cookie is present.
 * Creates a `Referral` row with status='pending' and links the new user to their referrer.
 * Also sends the referee the "welcome + $20 credit coming" email.
 *
 * Silently no-ops on any invalid state (no referrer found, self-referral, etc.).
 */
export async function captureReferral(
  newUserId: string,
  referralCode: string,
): Promise<void> {
  // Find referrer by code
  const referrer = await prisma.user.findFirst({
    where: { referralCode },
    select: { id: true, email: true, name: true },
  })
  if (!referrer) return

  // Anti-abuse: no self-referral
  if (referrer.id === newUserId) return

  // Check no existing referral for this referee (should be enforced by @unique, but guard here too)
  const existing = await prisma.referral.findFirst({
    where: { refereeId: newUserId },
  })
  if (existing) return

  // Get referee info for the welcome email
  const referee = await prisma.user.findUnique({
    where: { id: newUserId },
    select: { email: true, name: true },
  })
  if (!referee?.email) return

  // Create the pending referral row
  await prisma.$transaction([
    prisma.referral.create({
      data: {
        referrerId: referrer.id,
        refereeId: newUserId,
        status: 'pending',
      },
    }),
    prisma.user.update({
      where: { id: newUserId },
      data: { referredById: referrer.id },
    }),
  ])

  // Send referee the "you've been referred, $20 credit when you subscribe" email
  try {
    await sendReferralReceivedEmail({
      to: referee.email,
      refereeName: referee.name,
      referrerName: referrer.name,
    })
  } catch (err) {
    // Non-fatal — referral row already created
    console.error('[referral] failed to send referral-received email', err)
  }
}

// ── Qualification (first paid invoice) ───────────────────────────────────────

/**
 * Called from the Stripe webhook on `checkout.session.completed` when it's the
 * referee's FIRST payment (existingUser.firstPaidAt was null).
 *
 * Steps:
 * 1. Find pending Referral for this user
 * 2. Check referrer hasn't hit the cap
 * 3. Create $20 Stripe coupons for both parties (idempotent)
 * 4. Apply referee coupon to their Stripe customer now
 * 5. Apply referrer coupon to their Stripe customer
 * 6. Mark referral rewarded, update counters
 * 7. Send referrer the "you earned $20" email
 */
export async function qualifyReferral(
  refereeUserId: string,
  refereeStripeCustomerId: string,
): Promise<void> {
  // Find the pending referral
  const referral = await prisma.referral.findFirst({
    where: { refereeId: refereeUserId, status: 'pending' },
    include: {
      referrer: {
        select: {
          id: true,
          email: true,
          name: true,
          stripeCustomerId: true,
          referralCount: true,
        },
      },
    },
  })
  if (!referral) return

  // Anti-abuse: cap at MAX_REFERRALS
  if (referral.referrer.referralCount >= MAX_REFERRALS) {
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'abused' },
    })
    return
  }

  // Mark qualified immediately (idempotency guard for duplicate webhook)
  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: 'qualified', qualifiedAt: new Date() },
  })

  // ── Create Stripe coupons (idempotent via idempotencyKey) ─────────────────
  let referrerCouponId: string
  let refereeCouponId: string

  try {
    const [referrerCoupon, refereeCoupon] = await Promise.all([
      stripe.coupons.create(
        {
          amount_off: REFERRAL_CREDIT_CENTS,
          currency: 'usd',
          duration: 'once',
          name: 'Referral reward — $20',
          metadata: { referralId: referral.id, side: 'referrer' },
        },
        { idempotencyKey: `referral-${referral.id}-referrer` },
      ),
      stripe.coupons.create(
        {
          amount_off: REFERRAL_CREDIT_CENTS,
          currency: 'usd',
          duration: 'once',
          name: 'Referral credit — $20',
          metadata: { referralId: referral.id, side: 'referee' },
        },
        { idempotencyKey: `referral-${referral.id}-referee` },
      ),
    ])
    referrerCouponId = referrerCoupon.id
    refereeCouponId = refereeCoupon.id
  } catch (err) {
    console.error('[referral] failed to create Stripe coupons', err)
    // Roll back to pending so it can retry on next webhook
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'pending', qualifiedAt: null },
    })
    return
  }

  // ── Apply coupons to Stripe customers ────────────────────────────────────
  const customerUpdates: Promise<unknown>[] = [
    stripe.customers.update(refereeStripeCustomerId, { coupon: refereeCouponId }),
  ]
  if (referral.referrer.stripeCustomerId) {
    customerUpdates.push(
      stripe.customers.update(referral.referrer.stripeCustomerId, {
        coupon: referrerCouponId,
      }),
    )
  }

  try {
    await Promise.all(customerUpdates)
  } catch (err) {
    // Non-fatal — log and continue. Coupons are created; support can apply manually.
    console.error('[referral] failed to apply coupons to Stripe customers', err)
  }

  // ── Mark rewarded, update counters ────────────────────────────────────────
  await prisma.$transaction([
    prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'rewarded',
        stripeCouponReferrerId: referrerCouponId,
        stripeCouponRefereeId: refereeCouponId,
        rewardedAt: new Date(),
      },
    }),
    prisma.user.update({
      where: { id: referral.referrer.id },
      data: {
        referralCount: { increment: 1 },
        referralEarned: { increment: REFERRAL_CREDIT_CENTS / 100 },
      },
    }),
  ])

  // ── Send referrer the "you earned $20" email ──────────────────────────────
  if (referral.referrer.email) {
    try {
      await sendReferralQualifiedEmail({
        to: referral.referrer.email,
        referrerName: referral.referrer.name,
        creditAmount: REFERRAL_CREDIT_CENTS / 100,
      })
    } catch (err) {
      console.error('[referral] failed to send referral-qualified email', err)
    }
  }
}

// ── Clawback (refund within window) ──────────────────────────────────────────

/**
 * Called from the Stripe webhook on `charge.refunded`.
 * If the refunded user was a referee with a rewarded referral AND the refund
 * is within CLAWBACK_WINDOW_DAYS of their first payment, claw back the referrer's credit.
 */
export async function clawbackReferral(refereeStripeCustomerId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: refereeStripeCustomerId },
    select: { id: true, firstPaidAt: true },
  })
  if (!user || !user.firstPaidAt) return

  const daysSincePaid =
    (Date.now() - user.firstPaidAt.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSincePaid > CLAWBACK_WINDOW_DAYS) return

  const referral = await prisma.referral.findFirst({
    where: { refereeId: user.id, status: 'rewarded' },
    include: {
      referrer: {
        select: { id: true, stripeCustomerId: true },
      },
    },
  })
  if (!referral) return

  // Mark clawback status
  await prisma.$transaction([
    prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'clawback' },
    }),
    prisma.user.update({
      where: { id: referral.referrer.id },
      data: {
        referralCount: { decrement: 1 },
        referralEarned: { decrement: REFERRAL_CREDIT_CENTS / 100 },
      },
    }),
  ])

  // Delete the referrer's coupon if it hasn't been used yet
  if (referral.stripeCouponReferrerId) {
    try {
      await stripe.coupons.del(referral.stripeCouponReferrerId)
    } catch (err) {
      // May fail if already applied — acceptable, log only
      console.error('[referral] clawback: could not delete referrer coupon', err)
    }
  }
}

// ── Stats helper (for dashboard) ─────────────────────────────────────────────

export interface ReferralStats {
  code: string
  referralCount: number
  referralEarned: number
  recentReferrals: Array<{
    id: string
    refereeMasked: string
    status: string
    createdAt: Date
  }>
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const [user, referrals] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        referralCode: true,
        referralCount: true,
        referralEarned: true,
      },
    }),
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referee: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  if (!user) throw new Error(`User ${userId} not found`)

  const code = user.referralCode ?? (await ensureReferralCode(userId))

  return {
    code,
    referralCount: user.referralCount,
    referralEarned: user.referralEarned,
    recentReferrals: referrals.map((r) => ({
      id: r.id,
      refereeMasked: maskEmail(r.referee.email ?? ''),
      status: r.status,
      createdAt: r.createdAt,
    })),
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  if (!email.includes('@')) return '***'
  const [local, domain] = email.split('@')
  const visible = local.slice(0, 3)
  return `${visible}***@${domain}`
}
