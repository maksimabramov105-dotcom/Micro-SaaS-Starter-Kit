/**
 * lib/pricing.ts
 *
 * Single source of truth for all plan definitions.
 *
 * Shape: array `as const` — each entry is a flat object with `id`, `price`,
 * `period`, `intervalKey`, `dailyLimit`, `priceId`, and `features`.
 * Yearly plans are separate entries (id = `${family}_yearly`) so that:
 *   - downstream code reading `plan.id` keeps getting string literals
 *   - `getPlanByPriceId` works for both monthly AND yearly price IDs
 *   - the pricing-page toggle can filter by `intervalKey` to show the right
 *     3-card grid without changing any card component internals
 *
 * Prompt 05 additions:
 *   - `pro_yearly`       — $199/yr (save $40/yr vs monthly)
 *   - `unlimited_yearly` — $299/yr (save $60/yr vs monthly)
 *   - `intervalKey`      — 'month' | 'year' | null (replaces period for toggle logic)
 *   - `getPlanForCheckout(family, interval)` — checkout helper
 *   - `getMonthlyEquivalent(plan)` — returns effective monthly cost for display
 */

export const PRICING_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: null,
    dailyLimit: 3,
    priceId: null,
    intervalKey: null,
    features: ['3 applications/day', '1 resume', 'Adzuna + RemoteOK jobs'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19,
    period: 'month',
    dailyLimit: 25,
    priceId: process.env.STRIPE_PRICE_ID_PRO || null,
    intervalKey: 'month',
    features: [
      '25 applications/day',
      'Unlimited resumes',
      'LinkedIn autoapply',
      'All 5 PDF templates',
      'Priority support',
      '30-day money-back guarantee',
    ],
  },
  {
    id: 'pro_yearly',
    name: 'Pro',
    price: 180,
    period: 'year',
    dailyLimit: 25,
    priceId: process.env.STRIPE_PRICE_ID_PRO_YEARLY || null,
    intervalKey: 'year',
    features: [
      '25 applications/day',
      'Unlimited resumes',
      'LinkedIn autoapply',
      'All 5 PDF templates',
      'Priority support',
      '30-day money-back guarantee',
    ],
  },
  // Unlimited tier is HIDDEN until demand exists (Revenue Sprint A1). Entries
  // stay so getPlanByPriceId keeps resolving any legacy subscription price ids.
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: 29.99,
    period: 'month',
    dailyLimit: 9999,
    priceId: process.env.STRIPE_PRICE_ID_UNLIMITED || null,
    intervalKey: 'month',
    hidden: true,
    features: [
      'Unlimited applications',
      'Unlimited resumes',
      'All platforms',
      'API access',
      '30-day money-back guarantee',
    ],
  },
  {
    id: 'unlimited_yearly',
    name: 'Unlimited',
    price: 299,
    period: 'year',
    dailyLimit: 9999,
    priceId: process.env.STRIPE_PRICE_ID_UNLIMITED_YEARLY || null,
    intervalKey: 'year',
    hidden: true,
    features: [
      'Unlimited applications',
      'Unlimited resumes',
      'All platforms',
      'API access',
      '30-day money-back guarantee',
    ],
  },
] as const

export type PricingPlan = (typeof PRICING_PLANS)[number]
export type BillingInterval = 'month' | 'year'

/** Plans hidden from all pricing UIs and blocked at checkout (kept only for legacy price-id resolution). */
export function isHiddenPlan(plan: PricingPlan): boolean {
  return 'hidden' in plan && plan.hidden === true
}

/** The plans a visitor can actually see and buy. */
export const VISIBLE_PLANS = PRICING_PLANS.filter((p) => !isHiddenPlan(p))

/** Look up a plan by its Stripe price ID (works for both monthly + yearly). */
export function getPlanByPriceId(priceId: string | null | undefined): PricingPlan {
  return PRICING_PLANS.find((p) => p.priceId === priceId) ?? PRICING_PLANS[0]
}

/** Look up a plan by its slug (e.g. 'pro', 'pro_yearly'). */
export function getPlanById(id: string): PricingPlan {
  return PRICING_PLANS.find((p) => p.id === id) ?? PRICING_PLANS[0]
}

/**
 * Return the correct plan entry for a given plan family + billing interval.
 * Used by the checkout route so it can accept `(family, interval)` instead
 * of a raw price ID from the client.
 *
 * @example getPlanForCheckout('pro', 'year') → pro_yearly plan entry
 */
export function getPlanForCheckout(
  family: 'pro' | 'unlimited',
  interval: BillingInterval,
): PricingPlan | undefined {
  const id = interval === 'year' ? `${family}_yearly` : family
  return PRICING_PLANS.find((p) => p.id === id)
}

/**
 * Effective monthly cost for display purposes.
 * Yearly plans show their per-month equivalent ($199/12 ≈ $16.58).
 */
export function getMonthlyEquivalent(plan: PricingPlan): number {
  if (plan.period === 'year') return plan.price / 12
  return plan.price
}
