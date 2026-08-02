/**
 * lib/referral/offer.ts
 *
 * The referral offer, stated once.
 *
 * Split out of index.ts so that everything which only DESCRIBES the offer —
 * /terms, the dashboard, the emails — can import the numbers without pulling in
 * Prisma and Stripe.
 *
 * WHY THIS EXISTS: #90 swapped the reward from a double-sided $20 credit to
 * "the referrer gets a free month when their friend buys a year". It changed
 * the mechanics, the referrer email and the dashboard — and missed /terms and
 * the email sent to the referred user. For six weeks the terms of service and
 * a signup email promised a $20 credit that no code path could grant. Same
 * class of failure as the pricing drift lib/pricing.ts exists to prevent, so
 * the same answer: state it here, import it everywhere, never restate it.
 */

/** Months of Pro the REFERRER gets when a referral qualifies. */
export const REFERRAL_FREE_MONTHS = 1

/** Value of one free month, used for the referralEarned counter. */
export const PRO_MONTHLY_VALUE_USD = 19

/** Rewarded referrals per account, lifetime. */
export const MAX_REFERRALS = 10

/** A refund inside this window claws the referrer's reward back. */
export const CLAWBACK_WINDOW_DAYS = 30

export const REFERRAL_COOKIE = 'referral_code'

/**
 * The one plan whose purchase triggers a reward. A friend on Pro monthly,
 * Unlimited or the $4.99 rescue does NOT earn the referrer a free month —
 * the referral simply stays pending.
 */
export const QUALIFYING_PLAN_LABEL = 'Pro annual'

/**
 * What the REFERRED user gets: nothing. The program is one-sided.
 *
 * Kept explicit rather than implied by silence, because the copy that broke
 * was copy which assumed the referee side still existed.
 */
export const REFEREE_REWARD: null = null

/** "1 free month of Pro" / "3 free months of Pro" */
export function freeMonthsLabel(months: number = REFERRAL_FREE_MONTHS): string {
  return months === 1 ? '1 free month of Pro' : `${months} free months of Pro`
}
