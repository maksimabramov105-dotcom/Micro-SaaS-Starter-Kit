/**
 * PMF dashboard queries — all 12 metrics from PMF_FRAMEWORK.md § 2.
 * Cached for 15 minutes (900 s) via unstable_cache.
 */

import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getPlanByPriceId } from '@/lib/pricing'
import { EXIT_REASONS } from '@/lib/pmf/types'

// ── helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function pct(num: number, den: number): number | null {
  if (den === 0) return null
  return Math.round((num / den) * 100)
}

/**
 * Map Stripe priceId → MONTHLY recurring revenue in USD cents.
 * Annual plans bill 12 months up front but contribute price/12 to MRR, so we
 * normalize them — otherwise MRR/ARR would be overstated 12x for annual subs.
 */
function monthlyPriceCents(priceId: string | null | undefined): number {
  const plan = getPlanByPriceId(priceId)
  const cents = Math.round((plan.price ?? 0) * 100)
  return plan.intervalKey === 'year' ? Math.round(cents / 12) : cents
}

// ── TODAY ──────────────────────────────────────────────────────────────────

export const getTodayMetrics = unstable_cache(
  async () => {
    const start = todayStart()

    const [newFreeSignups, newPaidToday, cancelledToday, newPaidUsers] =
      await Promise.all([
        // New free signups (no subscription) created today
        prisma.user.count({
          where: { createdAt: { gte: start }, stripeSubscriptionId: null },
        }),
        // Free → paid conversions today
        prisma.user.count({
          where: { firstPaidAt: { gte: start } },
        }),
        // Cancellations today
        prisma.user.count({
          where: { cancelledAt: { gte: start } },
        }),
        // Users who first paid today (for MRR calc)
        prisma.user.findMany({
          where: { firstPaidAt: { gte: start } },
          select: { stripePriceId: true },
        }),
      ])

    const cancelledUsers = await prisma.user.findMany({
      where: { cancelledAt: { gte: start } },
      select: { stripePriceId: true },
    })

    const newMrrCents = newPaidUsers.reduce(
      (sum, u) => sum + monthlyPriceCents(u.stripePriceId),
      0
    )
    const lostMrrCents = cancelledUsers.reduce(
      (sum, u) => sum + monthlyPriceCents(u.stripePriceId),
      0
    )
    const netNewMrrCents = newMrrCents - lostMrrCents

    return {
      newFreeSignups,
      freeToPaidConversions: newPaidToday,
      cancellationsToday: cancelledToday,
      netNewMrrCents,
    }
  },
  ['pmf-today'],
  { revalidate: 900 }
)

// ── LAST 30 DAYS ───────────────────────────────────────────────────────────

export const getLast30DaysMetrics = unstable_cache(
  async () => {
    const since = daysAgo(30)

    const [
      appsTotal,
      appsSubmitted,
      appsInterview,
      appsOffer,
      surveyYes,
      surveyTotal,
      cancellations,
      totalPaidUsers,
    ] = await Promise.all([
      prisma.jobApplication.count({ where: { createdAt: { gte: since } } }),
      prisma.jobApplication.count({
        where: {
          createdAt: { gte: since },
          status: { in: ['SUBMITTED', 'INTERVIEW', 'OFFER'] },
        },
      }),
      prisma.jobApplication.count({
        where: { createdAt: { gte: since }, status: 'INTERVIEW' },
      }),
      prisma.jobApplication.count({
        where: { createdAt: { gte: since }, status: 'OFFER' },
      }),
      // Interview rate via survey responses
      prisma.survey.count({
        where: {
          type: 'interview_day30',
          answeredAt: { gte: since },
          response: { path: ['answer'], equals: 'yes' },
        },
      }),
      prisma.survey.count({
        where: { type: 'interview_day30', answeredAt: { gte: since } },
      }),
      // Cancellations with any refundReason (= confirmed exits, not just lapsed)
      prisma.user.count({
        where: { cancelledAt: { gte: since } },
      }),
      // Total paying users ever (for refund rate denominator)
      prisma.user.count({ where: { firstPaidAt: { not: null } } }),
    ])

    return {
      appsTotal,
      appsSubmitted,
      submissionSuccessRate: pct(appsSubmitted, appsTotal),
      appsWithInterview: appsInterview,
      // Prefer survey-based interview rate; fall back to application-status-based
      interviewRateSurvey: pct(surveyYes, surveyTotal),
      interviewRateApps: pct(appsInterview, appsSubmitted),
      appsMarkedGotJob: appsOffer,
      refundsIssued: cancellations,
      refundRate: pct(cancellations, totalPaidUsers),
    }
  },
  ['pmf-last30'],
  { revalidate: 900 }
)

// ── COHORT RETENTION ───────────────────────────────────────────────────────

export const getCohortRetention = unstable_cache(
  async () => {
    const now = new Date()

    const cohortDays = [30, 60, 90] as const

    const results = await Promise.all(
      cohortDays.map(async (days) => {
        // cohort window: users who first paid in the 7-day window ending `days` ago
        const windowEnd = daysAgo(days)
        const windowStart = daysAgo(days + 7)

        const [cohortSize, stillSubscribed] = await Promise.all([
          prisma.user.count({
            where: { firstPaidAt: { gte: windowStart, lt: windowEnd } },
          }),
          prisma.user.count({
            where: {
              firstPaidAt: { gte: windowStart, lt: windowEnd },
              stripeCurrentPeriodEnd: { gte: now },
            },
          }),
        ])

        return {
          days,
          cohortSize,
          stillSubscribed,
          retentionRate: pct(stillSubscribed, cohortSize),
        }
      })
    )

    return results
  },
  ['pmf-cohort'],
  { revalidate: 900 }
)

// ── REFERRAL LOOP ──────────────────────────────────────────────────────────

export const getReferralMetrics = unstable_cache(
  async () => {
    const since = daysAgo(30)

    const gotJobExits = await prisma.user.count({
      where: { cancelledAt: { gte: since }, refundReason: 'got_job' },
    })

    // Referral tracking not yet active — placeholder
    return {
      gotJobExitsThisMonth: gotJobExits,
      referralSignups: 0 as number,
      referralCoefficient: null as number | null,
    }
  },
  ['pmf-referral'],
  { revalidate: 900 }
)

// ── EXIT-REASON HISTOGRAM ──────────────────────────────────────────────────

export const getExitReasonHistogram = unstable_cache(
  async () => {
    const since = daysAgo(30)

    const rows = await prisma.user.groupBy({
      by: ['refundReason'],
      where: { cancelledAt: { gte: since }, refundReason: { not: null } },
      _count: { refundReason: true },
      orderBy: { _count: { refundReason: 'desc' } },
    })

    return rows.map((r) => ({
      reason: r.refundReason!,
      label:
        EXIT_REASONS.find((x) => x.value === r.refundReason)?.label ??
        r.refundReason!,
      count: r._count.refundReason,
    }))
  },
  ['pmf-exit-reasons'],
  { revalidate: 900 }
)

// ── ACQUISITION → REVENUE FUNNEL (last 30 days) ────────────────────────────
// One row answering the marketing-launch funnel: signup → activated (resume) →
// created campaign → applications SUBMITTED (honest _verify_submitted gate) →
// human replies → active paying subscriber. Same numbers as scripts/funnel_report.ts.
export const getFunnelReport = unstable_cache(
  async () => {
    const since = daysAgo(30)
    const now = new Date()
    const [signups, resumeUsers, campaignUsers, submitted, replyGroups, activeSubs] =
      await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.resume
          .findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] })
          .then((r) => r.length),
        prisma.autoApplyCampaign
          .findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] })
          .then((r) => r.length),
        prisma.jobApplication.count({ where: { status: 'SUBMITTED', createdAt: { gte: since } } }),
        prisma.inboxMessage.groupBy({
          by: ['classification'],
          where: { receivedAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.user.count({
          where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } },
        }),
      ])
    const c = (k: string) => replyGroups.find((g) => g.classification === k)?._count._all ?? 0
    const humanReplies = c('INTERVIEW_REQUEST') + c('REJECTION') + c('QUESTION')
    const interviews = c('INTERVIEW_REQUEST')
    return { signups, resumeUsers, campaignUsers, submitted, humanReplies, interviews, activeSubs }
  },
  ['pmf-funnel-report'],
  { revalidate: 900 }
)

// ── REVENUE (MRR / ARR / ARPU / paying customers / churned MRR) ─────────────
// Derived from the active-subscription rows that Stripe webhooks keep in sync
// on the User table (the DB is our materialized view of Stripe). MRR is
// monthly-normalized so annual subscribers count as price/12. scripts/
// funnel_report.ts additionally cross-checks this against the live Stripe API.

export const getRevenueMetrics = unstable_cache(
  async () => {
    const now = new Date()
    const [activeSubs, churned30d, payingEver, totalUsers] = await Promise.all([
      prisma.user.findMany({
        where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } },
        select: { stripePriceId: true },
      }),
      prisma.user.findMany({
        where: { cancelledAt: { gte: daysAgo(30) } },
        select: { stripePriceId: true },
      }),
      prisma.user.count({ where: { firstPaidAt: { not: null } } }),
      prisma.user.count(),
    ])

    const mrrCents = activeSubs.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0)
    const payingCustomers = activeSubs.length
    const churnedMrrCents = churned30d.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0)

    return {
      mrrCents,
      arrCents: mrrCents * 12,
      payingCustomers,
      arpuCents: payingCustomers > 0 ? Math.round(mrrCents / payingCustomers) : 0,
      churnedMrrCents,
      freeToPaidRate: pct(payingEver, totalUsers),
      payingEver,
      totalUsers,
    }
  },
  ['pmf-revenue'],
  { revalidate: 900 }
)

// ── WEEK-OVER-WEEK TRENDS ───────────────────────────────────────────────────
// The single most important investor view: are the core numbers growing each
// week? Returns the last 8 ISO weeks (Mon-anchored) with signups, free→paid
// conversions, applications submitted, interviews, and net-new MRR per week.

export type TrendMetric = 'signups' | 'conversions' | 'submitted' | 'interviews' | 'netNewMrrCents'
export interface WeekBucket {
  weekStart: string // YYYY-MM-DD (Monday)
  signups: number
  conversions: number
  submitted: number
  interviews: number
  netNewMrrCents: number
}

const TREND_WEEKS = 8

function weekStartIso(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const monday = (x.getDay() + 6) % 7 // days since Monday
  x.setDate(x.getDate() - monday)
  return x.toISOString().slice(0, 10)
}

export const getWeeklyTrends = unstable_cache(
  async (): Promise<WeekBucket[]> => {
    const cutoff = daysAgo(TREND_WEEKS * 7)
    const submittedStatuses = ['SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED'] as const

    const [signupRows, paidRows, churnRows, submittedRows, interviewRows] = await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: cutoff } }, select: { createdAt: true } }),
      prisma.user.findMany({ where: { firstPaidAt: { gte: cutoff } }, select: { firstPaidAt: true, stripePriceId: true } }),
      prisma.user.findMany({ where: { cancelledAt: { gte: cutoff } }, select: { cancelledAt: true, stripePriceId: true } }),
      prisma.jobApplication.findMany({ where: { status: { in: [...submittedStatuses] }, appliedAt: { gte: cutoff } }, select: { appliedAt: true } }),
      prisma.jobApplication.findMany({ where: { status: 'INTERVIEW', responseAt: { gte: cutoff } }, select: { responseAt: true } }),
    ])

    // Seed the last TREND_WEEKS weeks so the series has no gaps.
    const buckets = new Map<string, WeekBucket>()
    for (let i = TREND_WEEKS - 1; i >= 0; i--) {
      const ws = weekStartIso(daysAgo(i * 7))
      buckets.set(ws, { weekStart: ws, signups: 0, conversions: 0, submitted: 0, interviews: 0, netNewMrrCents: 0 })
    }
    const bump = (date: Date | null, key: TrendMetric, amt = 1) => {
      if (!date) return
      const b = buckets.get(weekStartIso(date))
      if (b) b[key] += amt
    }

    for (const r of signupRows) bump(r.createdAt, 'signups')
    for (const r of paidRows) {
      bump(r.firstPaidAt, 'conversions')
      bump(r.firstPaidAt, 'netNewMrrCents', monthlyPriceCents(r.stripePriceId))
    }
    for (const r of churnRows) bump(r.cancelledAt, 'netNewMrrCents', -monthlyPriceCents(r.stripePriceId))
    for (const r of submittedRows) bump(r.appliedAt, 'submitted')
    for (const r of interviewRows) bump(r.responseAt, 'interviews')

    return Array.from(buckets.values())
  },
  ['pmf-weekly-trends'],
  { revalidate: 900 }
)

// ── LAST UPDATED TIMESTAMP ─────────────────────────────────────────────────
// Not cached — always reflects actual render time
export function getLastUpdated(): Date {
  return new Date()
}
