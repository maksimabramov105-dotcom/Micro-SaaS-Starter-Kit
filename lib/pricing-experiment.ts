/**
 * lib/pricing-experiment.ts — the /pricing headline test: keys and copy.
 *
 * This test already existed, assigned server-side via getOrAssignVariant(). That
 * assignment is what made /pricing dynamic, and dynamic is what made it the
 * slowest page on the site: Lighthouse 72 against 99 on the landing page, with
 * LCP at 5.4 s despite a 190 ms server response and 70 ms of blocking time. The
 * code was never slow — it just got none of the static caching every other
 * marketing page gets, on the one page that takes money.
 *
 * Moving assignment into the browser (lib/ab.ts) keeps the same two variants and
 * the same experiment key, so results recorded before and after this change
 * remain comparable, and makes the page static again.
 */
import type { VariantSwaps } from '@/lib/ab'

/** Flag key in the FeatureFlag table. */
export const PRICING_FLAG = 'pricing_headline_b'

/** Unchanged from the server-assigned version, so history stays comparable. */
export const PRICING_EXPERIMENT = 'pricing_headline_v1'

export const PRICING_COOKIE = 'rai_pricing'

/**
 * Control is the plain description of what the page is. Variant B leads with the
 * guarantee, which is the objection most likely to be stopping the purchase.
 *
 * The guarantee is real and stated on /refund-policy — this is a test of which
 * true thing to lead with, not of how boldly to claim something.
 */
export const PRICING_CONTROL = {
  h1: 'Simple, Transparent Pricing',
  sub: 'Start free. Upgrade when you need more applications.',
} as const

export const PRICING_B = {
  h1: '30 days to change your mind. No questions asked.',
  sub: 'Start free and upgrade when you need the volume. Every paid plan is covered by a full 30-day refund.',
} as const

/** Element ids in app/pricing/page.tsx that variant B rewrites. */
export const PRICING_SWAPS: VariantSwaps = {
  'pricing-headline': PRICING_B.h1,
  'pricing-subhead': PRICING_B.sub,
}
