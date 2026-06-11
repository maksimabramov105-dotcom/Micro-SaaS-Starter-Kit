/**
 * lib/promo.ts — single source of truth for the launch/promo banner.
 *
 * The banner is DATA-DRIVEN and auto-hides once `endsAt` passes, so an expired
 * countdown can never render (a fast way to look like a scam + an FTC dark-pattern
 * risk). To run a new offer: set a real future `endsAt` and the matching Stripe
 * promo code, and flip nothing else. Do NOT use a rolling "X days left" window —
 * fake recurring urgency is exactly what we avoid.
 */
export interface Promo {
  /** Stripe promotion code shown at checkout. */
  code: string
  /** Human label, e.g. "40% off your first year". */
  discountLabel: string
  /** ISO end date/time. The banner hides on/after this instant. */
  endsAt: string
}

// Current promo. NOTE: this end date is in the past, so the banner is hidden.
// Set a future `endsAt` + a live Stripe code to run a new launch offer.
export const PROMO: Promo = {
  code: 'LAUNCH40',
  discountLabel: '40% off your first year',
  endsAt: '2026-06-08T23:59:59Z',
}

/** True only while the promo is still running (now strictly before endsAt). */
export function isPromoActive(now: Date = new Date(), promo: Promo = PROMO): boolean {
  const ends = new Date(promo.endsAt)
  return !Number.isNaN(ends.getTime()) && now.getTime() < ends.getTime()
}

/** Formatted end date for display (never a hardcoded string). */
export function promoEndLabel(promo: Promo = PROMO): string {
  const ends = new Date(promo.endsAt)
  if (Number.isNaN(ends.getTime())) return ''
  return ends.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
