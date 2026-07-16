/**
 * funnel_report.ts — investor-grade metrics export for the last N days.
 *
 * Run:  npx tsx scripts/funnel_report.ts [days] [--json]
 * VPS:  docker exec -i resumeai-web npx tsx scripts/funnel_report.ts 30 --json
 *
 * Prints, from real Postgres + Stripe data, the same figures the /admin/pmf
 * dashboard shows (see lib/pmf/queries.ts):
 *   funnel: signups · resume · campaign · SUBMITTED · replies · interviews · paid
 *   revenue: MRR · ARR · paying customers · blended ARPU · churned MRR · conv%
 *   week-over-week trends (8 weeks)
 *   Stripe reconciliation: DB-derived MRR vs the live Stripe API (source of truth)
 *
 * With --json it prints ONLY a JSON object (for export/piping). Plain Prisma +
 * the Stripe SDK — no new services, read-only.
 */
import { getUserFunnel, getWeek2Retention } from '../lib/pmf/user-funnel'
import { prisma } from '../lib/prisma'
import { getPlanByPriceId } from '../lib/pricing'
import { stripe } from '../lib/stripe'

const JSON_ONLY = process.argv.includes('--json')
const DAYS = Number(process.argv.find((a) => /^\d+$/.test(a))) || 30

/** MONTHLY recurring revenue in cents (annual plans normalized to price/12). */
function monthlyPriceCents(priceId: string | null | undefined): number {
  const plan = getPlanByPriceId(priceId)
  const cents = Math.round((plan.price ?? 0) * 100)
  return plan.intervalKey === 'year' ? Math.round(cents / 12) : cents
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function weekStartIso(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}

async function getFunnel(since: Date, now: Date) {
  const [signups, resumeUsers, campaignUsers, submitted, replyGroups, activeSubs] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.resume.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] }).then((r) => r.length),
    prisma.autoApplyCampaign.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] }).then((r) => r.length),
    prisma.jobApplication.count({ where: { status: 'SUBMITTED', createdAt: { gte: since } } }),
    prisma.inboxMessage.groupBy({ by: ['classification'], where: { receivedAt: { gte: since } }, _count: { _all: true } }),
    prisma.user.count({ where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } } }),
  ])
  const c = (k: string) => replyGroups.find((g) => g.classification === k)?._count._all ?? 0
  return {
    signups, resumeUsers, campaignUsers, submitted,
    interviewReplies: c('INTERVIEW_REQUEST'),
    questionReplies: c('QUESTION'),
    rejectionReplies: c('REJECTION'),
    automatedReplies: c('AUTOMATED'),
    humanReplies: c('INTERVIEW_REQUEST') + c('QUESTION') + c('REJECTION'),
    activeSubs,
  }
}

async function getRevenue(now: Date) {
  const [activeSubs, churned30d, payingEver, totalUsers] = await Promise.all([
    prisma.user.findMany({ where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } }, select: { stripePriceId: true } }),
    prisma.user.findMany({ where: { cancelledAt: { gte: daysAgo(30) } }, select: { stripePriceId: true } }),
    prisma.user.count({ where: { firstPaidAt: { not: null } } }),
    prisma.user.count(),
  ])
  const mrrCents = activeSubs.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0)
  const payingCustomers = activeSubs.length
  return {
    mrrCents,
    arrCents: mrrCents * 12,
    payingCustomers,
    arpuCents: payingCustomers > 0 ? Math.round(mrrCents / payingCustomers) : 0,
    churnedMrrCents: churned30d.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0),
    freeToPaidRatePct: totalUsers > 0 ? Math.round((payingEver / totalUsers) * 100) : null,
    payingEver,
    totalUsers,
  }
}

async function getWeeklyTrends(weeks = 8) {
  const cutoff = daysAgo(weeks * 7)
  const [signupRows, paidRows, churnRows, submittedRows, interviewRows] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: cutoff } }, select: { createdAt: true } }),
    prisma.user.findMany({ where: { firstPaidAt: { gte: cutoff } }, select: { firstPaidAt: true, stripePriceId: true } }),
    prisma.user.findMany({ where: { cancelledAt: { gte: cutoff } }, select: { cancelledAt: true, stripePriceId: true } }),
    prisma.jobApplication.findMany({ where: { status: { in: ['SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED'] }, appliedAt: { gte: cutoff } }, select: { appliedAt: true } }),
    prisma.jobApplication.findMany({ where: { status: 'INTERVIEW', responseAt: { gte: cutoff } }, select: { responseAt: true } }),
  ])
  type Bucket = { weekStart: string; signups: number; conversions: number; submitted: number; interviews: number; netNewMrrCents: number }
  const buckets = new Map<string, Bucket>()
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = weekStartIso(daysAgo(i * 7))
    buckets.set(ws, { weekStart: ws, signups: 0, conversions: 0, submitted: 0, interviews: 0, netNewMrrCents: 0 })
  }
  const bump = (d: Date | null, k: keyof Omit<Bucket, 'weekStart'>, amt = 1) => {
    if (!d) return
    const b = buckets.get(weekStartIso(d))
    if (b) b[k] += amt
  }
  signupRows.forEach((r) => bump(r.createdAt, 'signups'))
  paidRows.forEach((r) => { bump(r.firstPaidAt, 'conversions'); bump(r.firstPaidAt, 'netNewMrrCents', monthlyPriceCents(r.stripePriceId)) })
  churnRows.forEach((r) => bump(r.cancelledAt, 'netNewMrrCents', -monthlyPriceCents(r.stripePriceId)))
  submittedRows.forEach((r) => bump(r.appliedAt, 'submitted'))
  interviewRows.forEach((r) => bump(r.responseAt, 'interviews'))
  return Array.from(buckets.values())
}

/** Authoritative MRR straight from the Stripe API (source of truth for billing). */
async function getStripeMrrCents(): Promise<number | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null
  let total = 0
  for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
    for (const item of sub.items.data) {
      const unit = item.price.unit_amount ?? 0
      const qty = item.quantity ?? 1
      const monthly = item.price.recurring?.interval === 'year' ? Math.round((unit * qty) / 12) : unit * qty
      total += monthly
    }
  }
  return total
}

async function main() {
  const now = new Date()
  const since = daysAgo(DAYS)

  const [funnel, revenue, weekly, stripeMrrCents, acquisition, week2] = await Promise.all([
    getFunnel(since, now),
    getRevenue(now),
    getWeeklyTrends(),
    getStripeMrrCents().catch(() => null),
    getUserFunnel(since),
    getWeek2Retention(),
  ])

  const reconciliation =
    stripeMrrCents === null
      ? { stripeMrrCents: null, deltaCents: null, reconciles: null as boolean | null }
      : {
          stripeMrrCents,
          deltaCents: revenue.mrrCents - stripeMrrCents,
          // Reconciles when DB-derived MRR is within $1 of Stripe's number.
          reconciles: Math.abs(revenue.mrrCents - stripeMrrCents) <= 100,
        }

  const report = { generatedAt: now.toISOString(), days: DAYS, funnel, acquisition, week2Retention: week2, revenue, reconciliation, weeklyTrends: weekly }

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const $ = (c: number) => `$${(c / 100).toFixed(2)}`
  const pctOrDash = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`)
  const rows: [string, string | number][] = [
    [`Unique visitors (last ${DAYS}d)`, acquisition.landing_view],
    ['  visit -> signup', pctOrDash(acquisition.conversion.visitToSignup)],
    ['Activated users (G1 definition)', acquisition.first_application],
    ['  signup -> activated', pctOrDash(acquisition.conversion.signupToActivated)],
    ['Week-2 retention (14-28d cohort)', `${week2.retained}/${week2.cohortSize} (${pctOrDash(week2.rate)})`],
    ['---', '---'],
    [`Signups (last ${DAYS}d)`, funnel.signups],
    ['  created a resume', funnel.resumeUsers],
    ['  created a campaign', funnel.campaignUsers],
    [`Applications SUBMITTED (last ${DAYS}d)`, funnel.submitted],
    ['Replies - human (non-automated)', funnel.humanReplies],
    ['Replies - INTERVIEW_REQUEST', funnel.interviewReplies],
    ['Active paying subscribers (now)', funnel.activeSubs],
    ['---', '---'],
    ['MRR (DB-derived, monthly-normalized)', $(revenue.mrrCents)],
    ['ARR', $(revenue.arrCents)],
    ['Paying customers', revenue.payingCustomers],
    ['Blended ARPU', $(revenue.arpuCents)],
    ['Free -> paid conversion', revenue.freeToPaidRatePct === null ? '-' : `${revenue.freeToPaidRatePct}%`],
    ['Churned MRR (30d)', $(revenue.churnedMrrCents)],
    ['---', '---'],
    ['MRR (Stripe API, source of truth)', stripeMrrCents === null ? 'n/a (no STRIPE_SECRET_KEY)' : $(stripeMrrCents)],
    ['Reconciles with Stripe (+/- $1)', reconciliation.reconciles === null ? 'n/a' : reconciliation.reconciles ? 'YES' : `NO (delta ${$(reconciliation.deltaCents ?? 0)})`],
  ]
  const label = `ResumeAI investor metrics - last ${DAYS} days (${now.toISOString().slice(0, 16)}Z)`
  const width = Math.max(label.length, ...rows.map(([k]) => k.length)) + 14
  console.log('\n' + label)
  console.log('-'.repeat(width))
  for (const [k, v] of rows) console.log(k === '---' ? '-'.repeat(width) : k.padEnd(width - 12) + String(v).padStart(12))
  console.log('-'.repeat(width))
  console.log('\nWeek-over-week (signups / conversions / submitted / interviews / net-new MRR):')
  for (const w of weekly) {
    console.log(`  ${w.weekStart}  ${String(w.signups).padStart(4)} ${String(w.conversions).padStart(4)} ${String(w.submitted).padStart(5)} ${String(w.interviews).padStart(4)}  ${$(w.netNewMrrCents).padStart(10)}`)
  }
  console.log('\n(JSON export: re-run with --json)\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
