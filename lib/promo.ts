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

// Active promo — banner shows until endsAt, then auto-hides. The matching Stripe
// promotion code (LAUNCH40, 40% off) must exist for checkout to accept it.
//
// discountLabel says "first payment", not "first year": the live coupon
// (V8nDJ6pL) is percent_off 40 with duration `once`, and LAUNCH40 is redeemable
// on ANY plan. On the annual plan that is indeed 40% off the year, but a monthly
// subscriber gets 40% off month one only — so "first year" would be false for
// them. To advertise "first year" honestly, restrict the coupon to the annual
// price in Stripe first, then change this label.
export const PROMO: Promo = {
  code: 'LAUNCH40',
  discountLabel: '40% off your first payment',
  endsAt: '2026-09-01T23:59:59Z',
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
  // UTC explicitly. Without a timeZone this renders in the RUNTIME's zone, so
  // the client-rendered banner and the server-rendered pricing copy disagreed —
  // "Ends September 2" above "(ends September 1)" on the same page, because
  // endsAt is 23:59:59Z and the browser was an hour ahead. Same data, two
  // answers, side by side.
  return ends.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}
