/**
 * funnel_report.ts — single-shot acquisition→revenue funnel for the last N days.
 *
 * Run:  npx tsx scripts/funnel_report.ts [days]   (default 30)
 * On the VPS:  docker exec -i resumeai-web npx tsx scripts/funnel_report.ts
 *
 * Answers, from the prod DB, the questions the marketing launch needs:
 *   signups · activated (resume) · created campaign · applications SUBMITTED
 *   (status SUBMITTED == _verify_submitted passed) · inbound replies by class
 *   · active paying subscribers · MRR.
 *
 * Plain Prisma — no new services. The same numbers back the admin PMF page
 * (see getFunnelReport in lib/pmf/queries.ts).
 */
import { prisma } from '../lib/prisma'
import { getPlanByPriceId } from '../lib/pricing'

function monthlyPriceCents(priceId: string | null | undefined): number {
  return Math.round((getPlanByPriceId(priceId).price ?? 0) * 100)
}

async function main() {
  const days = Number(process.argv[2]) || 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const now = new Date()

  const [
    signups,
    resumeUsers,
    campaignUsers,
    submitted,
    replyGroups,
    activeSubs,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.resume
      .findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] })
      .then((r) => r.length),
    prisma.autoApplyCampaign
      .findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'] })
      .then((r) => r.length),
    // SUBMITTED == the honest _verify_submitted gate passed in the worker.
    prisma.jobApplication.count({ where: { status: 'SUBMITTED', createdAt: { gte: since } } }),
    prisma.inboxMessage.groupBy({
      by: ['classification'],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
    }),
    // Active paying subscribers = subscription set AND period not expired (point-in-time).
    prisma.user.findMany({
      where: { stripeSubscriptionId: { not: null }, stripeCurrentPeriodEnd: { gt: now } },
      select: { stripePriceId: true },
    }),
  ])

  const replies: Record<string, number> = {}
  for (const g of replyGroups) replies[g.classification] = g._count._all
  const human =
    (replies.INTERVIEW_REQUEST ?? 0) + (replies.REJECTION ?? 0) + (replies.QUESTION ?? 0)
  const mrrCents = activeSubs.reduce((s, u) => s + monthlyPriceCents(u.stripePriceId), 0)

  const rows: [string, string | number][] = [
    [`Signups (last ${days}d)`, signups],
    ['↳ created a resume', resumeUsers],
    ['↳ created a campaign', campaignUsers],
    [`Applications SUBMITTED (last ${days}d)`, submitted],
    ['Inbound · INTERVIEW_REQUEST', replies.INTERVIEW_REQUEST ?? 0],
    ['Inbound · QUESTION', replies.QUESTION ?? 0],
    ['Inbound · REJECTION', replies.REJECTION ?? 0],
    ['Inbound · AUTOMATED', replies.AUTOMATED ?? 0],
    ['Inbound · human replies (non-automated)', human],
    ['Active paying subscribers (now)', activeSubs.length],
    ['MRR', `$${(mrrCents / 100).toFixed(2)}`],
  ]

  const label = `ResumeAI funnel — last ${days} days (generated ${now.toISOString().slice(0, 16)}Z)`
  const width = Math.max(label.length, ...rows.map(([k]) => k.length)) + 12
  console.log('\n' + label)
  console.log('─'.repeat(width))
  for (const [k, v] of rows) console.log(k.padEnd(width - 10) + String(v).padStart(10))
  console.log('─'.repeat(width) + '\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
