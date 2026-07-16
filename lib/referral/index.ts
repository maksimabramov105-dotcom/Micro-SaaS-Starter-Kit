/**
 * lib/referral/index.ts
 *
 * In-house referral program: "refer a friend — when they get a year of Pro,
 * you get 1 free month of Pro."
 *
 * Reward: a 1-free-month-of-Pro Stripe coupon (100% off for 1 month) for the
 * REFERRER, granted ONLY when the referred friend's purchase is the Pro ANNUAL
 * plan. (Annual commitment is what makes a referral worth a free month, and it
 * pulls cash forward — see prompt 05/06.) The referee already gets the annual
 * price; the free month is the referrer's reward to share with their friend.
 *
 * Anti-abuse rules:
 *  - No self-referral
 *  - Max 10 rewarded referrals per user (documented in T&C)
 *  - Abused status manually set when fraud detected — coupons not issued
 *  - Clawback if referee refunds within 30 days
 *
 * Coupon idempotency: Stripe idempotency key = "referral-{referralId}-{side}"
 */

import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { getPlanById } from '@/lib/pricing'
import { customAlphabet } from 'nanoid'
import { sendReferralQualifiedEmail, sendReferralReceivedEmail } from './emails'

// ── Constants ─────────────────────────────────────────────────────────────────

export const REFERRAL_FREE_MONTHS = 1        // reward: 1 free month of Pro
export const PRO_MONTHLY_VALUE_USD = 19   // value of the free month (referralEarned tracking)
export const MAX_REFERRALS = 10              // max rewarded referrals per user per lifetime
export const REFERRAL_COOKIE = 'referral_code'
export const CLAWBACK_WINDOW_DAYS = 30

/** Stripe price ID for Pro annual — a referral only rewards when the friend buys this. */
export function proYearlyPriceId(): string | null {
  return getPlanById('pro_yearly').priceId
}

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
  refereePriceId?: string | null,
): Promise<void> {
  // Reward ONLY when the referred friend committed to a YEAR of Pro. A monthly
  // or Unlimited purchase doesn't trigger the free month. The referral stays
  // pending so it could still qualify if they upgrade to Pro annual later.
  const proYearly = proYearlyPriceId()
  if (!proYearly || refereePriceId !== proYearly) {
    console.log('[referral] referee purchase is not Pro annual — no free-month reward', { refereePriceId })
    return
  }

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

  // ── Create the 1-free-month-of-Pro coupon for the REFERRER (idempotent) ────
  // 100% off for 1 month. Applied to the referrer's Stripe customer so it lands
  // on their next Pro invoice (or their first, if they subscribe later).
  let referrerCouponId: string
  try {
    const coupon = await stripe.coupons.create(
      {
        percent_off: 100,
        duration: 'repeating',
        duration_in_months: REFERRAL_FREE_MONTHS,
        name: 'Referral reward — 1 free month of Pro',
        metadata: { referralId: referral.id, side: 'referrer', reward: 'free_month_pro' },
      },
      { idempotencyKey: `referral-${referral.id}-referrer-freemonth` },
    )
    referrerCouponId = coupon.id
  } catch (err) {
    console.error('[referral] failed to create free-month coupon', err)
    // Roll back to pending so it can retry on next webhook
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'pending', qualifiedAt: null },
    })
    return
  }

  // ── Apply the coupon to the referrer's Stripe customer (if they have one) ──
  if (referral.referrer.stripeCustomerId) {
    try {
      await stripe.customers.update(referral.referrer.stripeCustomerId, { coupon: referrerCouponId })
    } catch (err) {
      // Non-fatal — coupon exists; support/code can apply it when they subscribe.
      console.error('[referral] failed to apply free-month coupon to referrer', err)
    }
  }

  // ── Mark rewarded, update counters ────────────────────────────────────────
  await prisma.$transaction([
    prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'rewarded',
        stripeCouponReferrerId: referrerCouponId,
        rewardedAt: new Date(),
      },
    }),
    prisma.user.update({
      where: { id: referral.referrer.id },
      data: {
        referralCount: { increment: 1 },
        referralEarned: { increment: PRO_MONTHLY_VALUE_USD },
      },
    }),
  ])

  // ── Send the referrer the "you earned a free month of Pro" email ──────────
  if (referral.referrer.email) {
    try {
      await sendReferralQualifiedEmail({
        to: referral.referrer.email,
        referrerName: referral.referrer.name,
        freeMonths: REFERRAL_FREE_MONTHS,
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
        referralEarned: { decrement: PRO_MONTHLY_VALUE_USD },
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
