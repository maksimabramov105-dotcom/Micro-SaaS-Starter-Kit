/**
 * subscription.ts — Thin wrapper over lib/pricing.ts for admin/dashboard use.
 *
 * Previously contained stale BASIC/ENTERPRISE/YEARLY price IDs that don't
 * exist in production.  Now delegates to PRICING_PLANS (the single source of
 * truth) so plan metadata is never duplicated.  (YELLOW B5 audit fix)
 */
import { PRICING_PLANS, getPlanByPriceId } from '@/lib/pricing'

export { PRICING_PLANS as PLANS }

export function getUserPlan(stripePriceId: string | null) {
  return getPlanByPriceId(stripePriceId)
}

export function isSubscriptionActive(
  stripeCurrentPeriodEnd: Date | null
): boolean {
  if (!stripeCurrentPeriodEnd) return false
  return new Date(stripeCurrentPeriodEnd).getTime() + 86_400_000 > Date.now()
}
