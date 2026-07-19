/**
 * lib/nurture/index.ts — the autonomous lead-nurture engine (Session C).
 *
 * Two queues, both driven from the hourly daily-digest cron:
 *
 *  1. Lead sequence (enrolled at fit-check email capture, consent required):
 *       t0    full fit report          (sent inline at capture, stage 1)
 *       +2d   "3 fixes for your resume"
 *       +5d   tripwire offer
 *       +9d   data post + goodbye      (sequence ends)
 *     Every send re-checks: global suppression, unsubscribe, and purchase
 *     (RescueOrder paid or paying User with the same email) — purchase or
 *     unsubscribe stops the sequence permanently.
 *
 *  2. Abandoned checkout: RescueOrder stuck PENDING_PAYMENT for 4-28h gets
 *     exactly ONE reminder with a direct checkout link (the Stripe session
 *     stays valid 24h; after that we link the form instead).
 *
 * All emails: plain founder voice, unsubscribe link, no images, no tricks.
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { sendEmail } from '@/lib/email'
import { createLeadUnsubscribeToken } from '@/lib/nurture/token'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import type { Lead } from '@prisma/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
const DAY_MS = 86_400_000

/** Days to wait AFTER each stage (stage 1 = t0 report already sent). */
const STAGE_DELAYS_DAYS: Record<number, number> = { 1: 2, 2: 3, 3: 4 }
const FINAL_STAGE = 4

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await prisma.emailSuppression.findUnique({ where: { email: email.toLowerCase() } })
  return row !== null
}

export async function suppressEmail(email: string, reason: string): Promise<void> {
  const e = email.toLowerCase()
  await prisma.emailSuppression.upsert({
    where: { email: e },
    update: { reason },
    create: { email: e, reason },
  })
  await prisma.lead.updateMany({
    where: { email: e },
    data: { unsubscribedAt: new Date(), nurtureNextAt: null },
  })
}

/** Purchase check: any paid rescue order or paying user with this email. */
async function hasPurchased(email: string): Promise<boolean> {
  const e = email.toLowerCase()
  const [order, user] = await Promise.all([
    prisma.rescueOrder.findFirst({
      where: { email: e, status: { in: ['PAID', 'GENERATING', 'DELIVERED'] } },
      select: { id: true },
    }),
    prisma.user.findFirst({ where: { email: e, firstPaidAt: { not: null } }, select: { id: true } }),
  ])
  return order !== null || user !== null
}

function footer(email: string): string {
  const token = createLeadUnsubscribeToken(email)
  return (
    `\n\n—\nMaxim, founder of ResumeAI\n` +
    `You're getting this because you ran a free fit check on resumeai-bot.ru and opted in.\n` +
    `Unsubscribe (one click, immediate): ${APP_URL}/api/nurture/unsubscribe?token=${encodeURIComponent(token)}\n` +
    `Privacy: ${APP_URL}/privacy`
  )
}

function asHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const linked = escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;white-space:pre-wrap;line-height:1.6">${linked}</div>`
}

interface StageEmail {
  subject: string
  text: string
}

function buildStageEmail(stage: number, lead: Lead): StageEmail {
  const job = lead.lastJobTitle ? ` for "${lead.lastJobTitle}"` : ''
  const score = lead.lastScore !== null ? `${lead.lastScore}/100` : 'your score'

  switch (stage) {
    case 1: // t+2d — 3 fixes
      return {
        subject: 'The 3 fixes that move a fit score most',
        text:
          `You checked your resume${job} a couple of days ago and scored ${score}.\n\n` +
          `Across the applications our pipeline verifies, three fixes move scores the most:\n\n` +
          `1. Mirror the posting's exact wording for your top skills — screening software matches terms, not synonyms.\n` +
          `2. Put the role's title (truthfully) in your summary line — recruiters scan the top third first.\n` +
          `3. Quantify the two most recent bullets — "cut response time 35%" beats a duty description every time.\n\n` +
          `Do those three by hand and re-run the free check: ${APP_URL}/ats-check\n` +
          `Or have it done for one specific job in minutes: ${APP_URL}/resume-rescue` +
          footer(lead.email),
      }
    case 2: // t+5d — tripwire offer
      return {
        subject: `Your resume, rewritten for one job — $4.99`,
        text:
          `Quick one. If you're still going after that role${job}, the highest-leverage thing you can do ` +
          `is send a resume written for THAT posting, not a general one.\n\n` +
          `Resume Rescue does exactly that for $4.99, one-time:\n` +
          `- your resume rewritten for the specific posting (honest — nothing invented)\n` +
          `- a fit report: score breakdown, the ATS keywords you're missing, concrete fixes\n` +
          `- delivered in minutes, auto-refund if generation fails\n\n` +
          `${APP_URL}/resume-rescue\n\n` +
          `No subscription, no upsell tricks — if it's not useful, there's a 30-day refund.` +
          footer(lead.email),
      }
    default: // t+9d — data post + goodbye
      return {
        subject: 'What verified application data says (last one from me)',
        text:
          `Last email in this series — no more unless you ask.\n\n` +
          `We publish live numbers from our verified pipeline: how many applications actually reach ` +
          `a human, and exactly how automated applications fail (bot walls, stale postings, surprise ` +
          `required fields). If you're job hunting, ten minutes here will change how you apply:\n\n` +
          `${APP_URL}/blog/how-many-applications-reach-a-human\n` +
          `${APP_URL}/blog/auto-apply-failure-modes\n\n` +
          `And whenever you need a resume built for one specific job: ${APP_URL}/resume-rescue\n\n` +
          `Good luck out there.` +
          footer(lead.email),
      }
  }
}

/** Advance every due lead one step. Returns how many emails were sent. */
export async function processNurtureQueue(limit = 25): Promise<number> {
  const due = await prisma.lead.findMany({
    where: {
      nurtureNextAt: { not: null, lte: new Date() },
      unsubscribedAt: null,
      convertedAt: null,
      consentAt: { not: null },
    },
    orderBy: { nurtureNextAt: 'asc' },
    take: limit,
  })

  let sent = 0
  for (const lead of due) {
    if (await isSuppressed(lead.email)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { nurtureNextAt: null } })
      continue
    }
    if (await hasPurchased(lead.email)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { convertedAt: new Date(), nurtureNextAt: null },
      })
      continue
    }

    const { subject, text } = buildStageEmail(lead.nurtureStage, lead)
    const result = await sendEmail({ to: lead.email, subject, html: asHtml(text) })
    if (!result.success) {
      // Transient failure: retry this stage in 6h rather than skipping it.
      await prisma.lead.update({
        where: { id: lead.id },
        data: { nurtureNextAt: new Date(Date.now() + 6 * 3600_000) },
      })
      continue
    }

    const nextStage = lead.nurtureStage + 1
    const delayDays = STAGE_DELAYS_DAYS[nextStage as keyof typeof STAGE_DELAYS_DAYS]
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        nurtureStage: nextStage,
        nurtureNextAt:
          nextStage >= FINAL_STAGE || delayDays === undefined
            ? null
            : new Date(Date.now() + delayDays * DAY_MS),
      },
    })
    trackEvent({
      event: 'nurture_sent',
      properties: { leadId: lead.id, stage: nextStage, email_domain: lead.email.split('@')[1] },
    }).catch(() => {})
    sent++
  }
  return sent
}

/**
 * Abandoned tripwire checkouts: PENDING_PAYMENT for 4-28h, one email ever.
 * The Stripe Checkout session is valid 24h, so inside that window we link it
 * directly; afterwards we link the form.
 */
export async function processAbandonedCheckouts(limit = 10): Promise<number> {
  const now = Date.now()
  const orders = await prisma.rescueOrder.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      abandonedEmailAt: null,
      createdAt: { lte: new Date(now - 4 * 3600_000), gte: new Date(now - 28 * 3600_000) },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  let sent = 0
  for (const order of orders) {
    if (await isSuppressed(order.email)) {
      await prisma.rescueOrder.update({
        where: { id: order.id },
        data: { abandonedEmailAt: new Date() },
      })
      continue
    }

    let checkoutUrl = `${APP_URL}/resume-rescue`
    if (order.stripeSessionId && now - order.createdAt.getTime() < 23 * 3600_000) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId)
        if (session.status === 'open' && session.url) checkoutUrl = session.url
      } catch {
        /* fall back to the form */
      }
    }

    const text =
      `You started a Resume Rescue for "${order.jobTitle}"${order.jobCompany ? ` at ${order.jobCompany}` : ''} ` +
      `but didn't finish checkout — your details are saved.\n\n` +
      `Finish here (takes ~30 seconds): ${checkoutUrl}\n\n` +
      `It's $4.99 one-time: your resume rewritten for that exact posting plus a fit report, ` +
      `delivered in minutes, auto-refund if we fail. This is the only reminder I'll send.` +
      footer(order.email)

    const result = await sendEmail({
      to: order.email,
      subject: `Your resume rescue for "${order.jobTitle}" is one click from done`,
      html: asHtml(text),
    })
    if (result.success) {
      await prisma.rescueOrder.update({
        where: { id: order.id },
        data: { abandonedEmailAt: new Date() },
      })
      trackEvent({ event: 'abandoned_email_sent', properties: { orderId: order.id } }).catch(
        () => {},
      )
      sent++
    }
  }
  return sent
}

/** t0 email: the full fit report, sent inline at capture. */
export async function sendFitReportEmail(args: {
  email: string
  score: number
  findings: string[]
  hints: string[]
  jobTitle?: string
}): Promise<void> {
  const job = args.jobTitle ? ` for "${args.jobTitle}"` : ''
  const findings = args.findings.map((f) => `- ${f}`).join('\n')
  const hints = args.hints.map((h, i) => `${i + 1}. ${h}`).join('\n')
  const text =
    `Your fit score${job}: ${args.score}/100\n\n` +
    `What the scorer found:\n${findings}\n\n` +
    `Your 3 highest-leverage fixes:\n${hints}\n\n` +
    `Want it done for you? Resume Rescue rewrites your resume for that exact posting and ` +
    `includes the full keyword report — $4.99 one-time, delivered in minutes:\n` +
    `${APP_URL}/resume-rescue\n\n` +
    `Keep this email — the score is a baseline to beat.` +
    footer(args.email)
  await sendEmail({
    to: args.email,
    subject: `Your fit score${job}: ${args.score}/100`,
    html: asHtml(text),
  })
}

/** Enroll (or refresh) a lead in the nurture sequence at capture time. */
export async function enrollLead(args: {
  email: string
  source: string
  score?: number
  jobTitle?: string
}): Promise<Lead | null> {
  const email = args.email.toLowerCase()
  if (await isSuppressed(email)) return null

  const existing = await prisma.lead.findFirst({
    where: { email, unsubscribedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    // Refresh personalization; re-enroll only if the sequence finished long ago.
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        lastScore: args.score ?? existing.lastScore,
        lastJobTitle: args.jobTitle?.slice(0, 200) ?? existing.lastJobTitle,
        consentAt: existing.consentAt ?? new Date(),
        ...(existing.nurtureNextAt === null && existing.nurtureStage === 0
          ? { nurtureStage: 1, nurtureNextAt: new Date(Date.now() + 2 * DAY_MS) }
          : {}),
      },
    })
  }
  return prisma.lead.create({
    data: {
      email,
      source: args.source.slice(0, 80),
      consentAt: new Date(),
      lastScore: args.score ?? null,
      lastJobTitle: args.jobTitle?.slice(0, 200) ?? null,
      // Stage 1 = the t0 report was sent inline at capture; next step in 2d.
      nurtureStage: 1,
      nurtureNextAt: new Date(Date.now() + 2 * DAY_MS),
    },
  })
}
