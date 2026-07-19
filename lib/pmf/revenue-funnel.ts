/**
 * lib/pmf/revenue-funnel.ts — the Revenue Sprint funnel (Session C3).
 *
 * The capture -> nurture -> convert path, distinct from the acquisition funnel
 * in user-funnel.ts (which tracks signups -> activation). This one measures the
 * money path built in Sessions A-C:
 *
 *   seo_visit -> fitcheck_started -> lead_captured -> tripwire_paid -> pro_subscribed
 *
 * plus the revenue split between the one-time tripwire and subscription MRR.
 *
 * Sources (single source of truth for the dashboard AND the founder email):
 *   seo_visit        distinct AnalyticsEvent.sessionId of page_view in window
 *   fitcheck_started AnalyticsEvent 'fitcheck_started' in window
 *   lead_captured    AnalyticsEvent 'lead_captured' in window (email + consent)
 *   tripwire_paid    RescueOrder with a real payment intent, paid in window
 *   pro_subscribed   User.firstPaidAt in window
 */
import { getPlanByPriceId } from '@/lib/pricing'
import { prisma } from '@/lib/prisma'

const TRIPWIRE_PRICE_CENTS = 499

function ratio(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 100) : null
}

/** MONTHLY recurring revenue in cents (annual normalized to price/12). */
function monthlyPriceCents(priceId: string | null | undefined): number {
  const plan = getPlanByPriceId(priceId)
  const cents = Math.round((plan.price ?? 0) * 100)
  return plan.intervalKey === 'year' ? Math.round(cents / 12) : cents
}

export interface RevenueFunnel {
  since: Date
  seoVisit: number
  fitcheckStarted: number
  leadCaptured: number
  tripwirePaid: number
  proSubscribed: number
  conversion: {
    visitToFitcheck: number | null
    fitcheckToLead: number | null
    leadToTripwire: number | null
    tripwireToPro: number | null
  }
  revenue: {
    tripwireGrossCents: number // one-time, in window
    tripwirePaidCount: number
    subscriptionMrrCents: number // current active MRR (point-in-time)
    activeLeadsInNurture: number
    suppressed: number
  }
}

export async function getRevenueFunnel(since?: Date): Promise<RevenueFunnel> {
  const start = since ?? new Date(Date.now() - 30 * 86_400_000)
  const now = new Date()

  const [
    visitorRows,
    fitcheckStarted,
    leadCaptured,
    tripwireOrders,
    proSubscribed,
    activeSubs,
    activeLeadsInNurture,
    suppressed,
  ] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { event: 'page_view', createdAt: { gte: start }, sessionId: { not: null } },
      distinct: ['sessionId'],
      select: { sessionId: true },
    }),
    prisma.analyticsEvent.count({ where: { event: 'fitcheck_started', createdAt: { gte: start } } }),
    prisma.analyticsEvent.count({ where: { event: 'lead_captured', createdAt: { gte: start } } }),
    // Real tripwire purchases (has a payment intent → not a $0 promo test),
    // not refunded, paid in window.
    prisma.rescueOrder.findMany({
      where: {
        paymentIntentId: { not: null },
        paidAt: { gte: start },
        status: { in: ['PAID', 'GENERATING', 'DELIVERED'] },
      },
      select: { id: true },
    }),
    prisma.user.count({ where: { firstPaidAt: { gte: start } } }),
    prisma.user.findMany({
      where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } },
      select: { stripePriceId: true },
    }),
    prisma.lead.count({
      where: { nurtureNextAt: { not: null }, unsubscribedAt: null, convertedAt: null },
    }),
    prisma.emailSuppression.count(),
  ])

  const seoVisit = visitorRows.length
  const tripwirePaid = tripwireOrders.length
  const subscriptionMrrCents = activeSubs.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0)

  return {
    since: start,
    seoVisit,
    fitcheckStarted,
    leadCaptured,
    tripwirePaid,
    proSubscribed,
    conversion: {
      visitToFitcheck: ratio(fitcheckStarted, seoVisit),
      fitcheckToLead: ratio(leadCaptured, fitcheckStarted),
      leadToTripwire: ratio(tripwirePaid, leadCaptured),
      tripwireToPro: ratio(proSubscribed, tripwirePaid),
    },
    revenue: {
      tripwireGrossCents: tripwirePaid * TRIPWIRE_PRICE_CENTS,
      tripwirePaidCount: tripwirePaid,
      subscriptionMrrCents,
      activeLeadsInNurture,
      suppressed,
    },
  }
}
