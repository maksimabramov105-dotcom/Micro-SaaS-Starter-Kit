/**
 * lib/lifecycle/weekly.ts — the weekly user digest (P3.4).
 *
 * The retention loop, and deliberately NOT the same thing as the existing daily
 * digest in lib/notifications/digest.ts. That one is paid-only, fires at 8am
 * local, and reports yesterday. This one goes to anyone who actually used the
 * product that week, paid or not, because retention is the thing we are trying
 * to create and a free user who never hears from us churns silently.
 *
 * The differentiator is the FIT TIP. We already store a per-factor fit
 * breakdown on every application (P3.2). Aggregating it across a user's week
 * tells them the ONE thing most likely to be costing them replies — which is a
 * genuinely useful email rather than a stats dump, and it is something no
 * competitor can send because they do not compute it.
 *
 * Anti-spam rules, in order:
 *   - never twice in the same ISO week (AnalyticsEvent marker)
 *   - never to a suppressed address (shared list)
 *   - never when there is nothing to report — no activity means no email, not
 *     a cheerful message about zero
 */
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { trackEvent } from '@/lib/analytics-advanced'
import { isSuppressed } from '@/lib/nurture'
import { SITE_URL, SUPPORT_EMAIL } from '@/lib/site'

const MARKER = 'weekly_digest_sent'
const BATCH = 50

/** Points each factor can contribute — mirrors ai/jobfit.py. */
const FACTOR_MAX: Record<string, number> = {
  skills: 50,
  seniority: 25,
  eligibility: 15,
  language: 10,
}

const FACTOR_TIP: Record<string, string> = {
  skills:
    'Your resumes are scoring low on skills overlap. Mirror the posting’s exact wording for tools you genuinely use — most filters match on presence, not synonyms.',
  seniority:
    'Your seniority band keeps reading off from the postings. Applying at the right level beats applying to more roles.',
  eligibility:
    'Knockout questions (work authorisation, location) are filtering you out before a human looks. Make your status explicit at the top of the resume.',
  language:
    'Postings are asking for a language your profile doesn’t list. Add it if you have it — truthfully.',
}

/** ISO-week key, e.g. "2026-W31". Two sends in one week is the failure mode. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** The weakest factor across a set of breakdowns, or null if none recorded. */
export function weakestFactor(
  breakdowns: Array<Record<string, number> | null | undefined>,
): string | null {
  const totals: Record<string, { sum: number; n: number }> = {}
  for (const b of breakdowns) {
    if (!b) continue
    for (const [k, v] of Object.entries(b)) {
      if (!(k in FACTOR_MAX) || typeof v !== 'number') continue
      totals[k] ??= { sum: 0, n: 0 }
      totals[k].sum += v / FACTOR_MAX[k]
      totals[k].n += 1
    }
  }
  const ranked = Object.entries(totals)
    .filter(([, t]) => t.n > 0)
    .map(([k, t]) => [k, t.sum / t.n] as const)
    .sort((a, b) => a[1] - b[1])
  // Only call something a weakness if it is actually weak.
  return ranked.length > 0 && ranked[0][1] < 0.75 ? ranked[0][0] : null
}

function buildEmail(opts: {
  first: string
  email: string
  applications: number
  submitted: number
  replies: number
  tipFactor: string | null
}): { subject: string; text: string } {
  const { first, email, applications, submitted, replies, tipFactor } = opts
  const unsub = `${SITE_URL}/api/nurture/unsubscribe?email=${encodeURIComponent(email)}`

  const lines = [
    `Hi ${first},`,
    '',
    'Your week:',
    '',
    `  Applications tracked: ${applications}`,
    `  Confirmed submitted:  ${submitted}`,
    `  Replies received:     ${replies}`,
    '',
  ]

  if (tipFactor) {
    lines.push(
      'One thing worth fixing:',
      '',
      FACTOR_TIP[tipFactor],
      '',
      'That comes from the fit reports on your own applications this week, not a',
      'generic tip list.',
      '',
    )
  } else if (applications > 0) {
    lines.push(
      'Nothing stands out as a systematic weakness in your fit reports this week,',
      'which usually means the lever is volume rather than the resume.',
      '',
    )
  }

  if (replies === 0 && submitted > 0) {
    lines.push(
      'No replies yet is normal at this volume — most confirmed applications never',
      'get one. We only ever count an application as submitted when the ATS',
      'confirms it, so these numbers are real:',
      '',
      `${SITE_URL}/proof`,
      '',
    )
  }

  lines.push(
    `Full detail, with the per-application breakdown: ${SITE_URL}/dashboard`,
    '',
    '—',
    'Maxim, ResumeAI',
    'Reply to this email and it reaches me directly.',
    `Unsubscribe: ${unsub}`,
  )

  return {
    subject: `Your week: ${applications} application${applications === 1 ? '' : 's'}${
      replies > 0 ? `, ${replies} repl${replies === 1 ? 'y' : 'ies'}` : ''
    }`,
    text: lines.join('\n'),
  }
}

/**
 * Called from the hourly cron. Self-gates to Monday 09:00-11:59 UTC so it lands
 * at the start of the working week rather than on a Sunday night.
 */
export async function maybeSendWeeklyDigests(now: Date = new Date()): Promise<number> {
  if (now.getUTCDay() !== 1) return 0
  const hour = now.getUTCHours()
  if (hour < 9 || hour > 11) return 0

  const week = isoWeek(now)
  const since = new Date(now.getTime() - 7 * 24 * 3600_000)

  // Only users with activity this week — silence beats a cheerful zero.
  const active = await prisma.jobApplication.groupBy({
    by: ['userId'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    // Prisma requires orderBy whenever take is used on groupBy. Busiest users
    // first, so if a week ever exceeds the batch the most engaged are served.
    orderBy: { _count: { userId: 'desc' } },
    take: BATCH,
  })
  if (active.length === 0) return 0

  const userIds = active.map((a) => a.userId)
  const [users, alreadySent] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds }, email: { not: null } },
      select: { id: true, name: true, email: true },
    }),
    prisma.analyticsEvent.findMany({
      where: {
        event: MARKER,
        userId: { in: userIds },
        properties: { path: ['week'], equals: week },
      },
      select: { userId: true },
    }),
  ])
  const done = new Set(alreadySent.map((r) => r.userId))

  let sent = 0
  for (const u of users) {
    if (!u.email || done.has(u.id)) continue
    if (await isSuppressed(u.email)) continue

    const apps = await prisma.jobApplication.findMany({
      where: { userId: u.id, createdAt: { gte: since } },
      select: { status: true, fitBreakdown: true },
    })
    if (apps.length === 0) continue

    const submitted = apps.filter((a) =>
      ['SUBMITTED', 'INTERVIEW', 'OFFER'].includes(a.status),
    ).length
    const replies = await prisma.inboxMessage
      .count({ where: { userId: u.id, receivedAt: { gte: since } } })
      .catch(() => 0)

    const { subject, text } = buildEmail({
      first: u.name?.split(' ')[0] || 'there',
      email: u.email,
      applications: apps.length,
      submitted,
      replies,
      tipFactor: weakestFactor(apps.map((a) => a.fitBreakdown as Record<string, number> | null)),
    })

    const result = await sendEmail({
      to: u.email,
      subject,
      html: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap;max-width:600px">${text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</div>`,
      replyTo: SUPPORT_EMAIL,
    })
    if (!result.success) continue

    await trackEvent({ event: MARKER, userId: u.id, properties: { week } }).catch(() => {})
    sent++
  }
  return sent
}
