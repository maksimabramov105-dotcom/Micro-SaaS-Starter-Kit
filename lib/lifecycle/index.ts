/**
 * lib/lifecycle/index.ts — user lifecycle emails (P4.3).
 *
 * Welcome, day-1, day-3, day-7. Plain text, founder voice, one link each.
 *
 * WHY THIS EXISTS: sendWelcomeEmail() has been defined in lib/email.ts since the
 * beginning and was NEVER CALLED. A user could sign up and hear nothing, ever.
 * For a product whose whole retention story is "you get tangible artifacts every
 * week", silence after signup is the worst possible first impression.
 *
 * DESIGN NOTES
 *
 * State lives in AnalyticsEvent, not new User columns. The marker pattern is
 * already used by the daily pulse and the SEO cron, it needs no migration, and
 * it means the send history is queryable next to every other funnel event. A
 * user who already received `lifecycle_email_sent {stage: 'day3'}` never gets it
 * twice, even if the cron double-fires.
 *
 * Suppression is checked against the SAME list the nurture engine writes to, so
 * one unsubscribe silences marketing everywhere rather than per-system — the
 * thing users actually expect and the thing regulators care about.
 *
 * Every stage is skippable by content: day-1 is about a tailored resume, so if
 * the user has already generated one it would read as a bot that isn't paying
 * attention. We skip rather than send something inapplicable.
 */
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { trackEvent } from '@/lib/analytics-advanced'
import { isSuppressed } from '@/lib/nurture'
import { SITE_URL, SUPPORT_EMAIL } from '@/lib/site'

const MARKER = 'lifecycle_email_sent'

export type Stage = 'welcome' | 'day1' | 'day3' | 'day7'

/** Hours after signup each stage becomes due. */
const DUE_AFTER_HOURS: Record<Exclude<Stage, 'welcome'>, number> = {
  day1: 24,
  day3: 72,
  day7: 168,
}

/** Max users processed per cron tick — keeps one run bounded. */
const BATCH = 25

function footer(email: string): string {
  const url = `${SITE_URL}/api/nurture/unsubscribe?email=${encodeURIComponent(email)}`
  return `

—
Maxim, ResumeAI
Reply to this email and it reaches me directly.
Unsubscribe: ${url}`
}

interface Ctx {
  name: string
  applications: number
  replies: number
  resumes: number
}

/** Plain-text bodies. No images, no tracking pixels, no marketing voice. */
function body(stage: Stage, ctx: Ctx, email: string): { subject: string; text: string } {
  const first = ctx.name?.split(' ')[0] || 'there'
  switch (stage) {
    case 'welcome':
      return {
        subject: 'You’re in — here’s the fastest way to get value',
        text: `Hi ${first},

Thanks for signing up to ResumeAI.

The quickest thing you can do right now, and it takes about two minutes:
paste a job you actually want into the free fit check. You'll get a score, the
keywords that posting wants which your resume is missing, and what to fix.

${SITE_URL}/ats-check

One thing worth knowing up front: we never mark an application as "applied"
without a real ATS confirmation. If you ever see a number here, it happened.
That's the whole point of the product.

Any questions, just reply.${footer(email)}`,
      }
    case 'day1':
      return {
        subject: 'The single highest-leverage 10 minutes in a job search',
        text: `Hi ${first},

Most rejections aren't about you being underqualified. They're about the resume
not mirroring the posting's language, so the filter never scores you properly.

Tailoring one resume for one specific role beats sending ten generic ones. If
you want to see the difference on a job you care about:

${SITE_URL}/resume-rescue

You paste the posting, you get the rewritten resume plus a report showing what
was getting you filtered out. Delivered in minutes.${footer(email)}`,
      }
    case 'day3':
      return {
        subject: ctx.applications > 0 ? 'Your applications so far' : 'Stuck on where to start?',
        text:
          ctx.applications > 0
            ? `Hi ${first},

You've got ${ctx.applications} application${ctx.applications === 1 ? '' : 's'} tracked so far${
                ctx.replies > 0 ? ` and ${ctx.replies} repl${ctx.replies === 1 ? 'y' : 'ies'}` : ''
              }.

Every one has a fit report attached — score, what the scorer saw, and the single
biggest thing to change. If a few are scoring low on the same factor, that's
your pattern, and it's usually fixable in one editing session.

${SITE_URL}/dashboard${footer(email)}`
            : `Hi ${first},

You signed up a few days ago and haven't tracked an application yet. No judgement
— the hardest part is starting.

The lowest-friction first step is the free fit check. One job, two minutes, and
you'll know whether your resume is the problem or whether you're aiming at the
wrong level:

${SITE_URL}/ats-check${footer(email)}`,
      }
    case 'day7':
      return {
        subject: 'Your week in review',
        text: `Hi ${first},

A week in. Here's what actually happened:

  Applications tracked: ${ctx.applications}
  Replies received:     ${ctx.replies}
  Resumes created:      ${ctx.resumes}

If those numbers are lower than you'd like, the honest answer is usually one of
two things: not enough volume, or a resume that isn't matching the postings.
Your fit reports tell you which.

${SITE_URL}/dashboard

And if this isn't useful, unsubscribing below is completely fine — I'd rather
that than clutter your inbox.${footer(email)}`,
      }
  }
}

/** Send one stage to one user, recording the marker so it never repeats. */
async function sendStage(
  userId: string,
  email: string,
  stage: Stage,
  ctx: Ctx,
): Promise<boolean> {
  if (await isSuppressed(email)) return false

  const { subject, text } = body(stage, ctx, email)
  const result = await sendEmail({
    to: email,
    subject,
    // Plain text intentionally — founder voice reads as a person, not a campaign.
    html: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap;max-width:600px">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</div>`,
    replyTo: SUPPORT_EMAIL,
  })
  if (!result.success) return false

  await trackEvent({ event: MARKER, userId, properties: { stage } }).catch(() => {})
  return true
}

/** Public: send the welcome email. Called from the auth createUser event. */
export async function sendWelcome(userId: string, email: string, name: string | null) {
  try {
    const already = await prisma.analyticsEvent.findFirst({
      where: { event: MARKER, userId, properties: { path: ['stage'], equals: 'welcome' } },
      select: { id: true },
    })
    if (already) return
    await sendStage(userId, email, 'welcome', {
      name: name ?? '',
      applications: 0,
      replies: 0,
      resumes: 0,
    })
  } catch (err) {
    // Never block signup on an email failure.
    console.warn('[lifecycle] welcome send failed:', err)
  }
}

/**
 * Called hourly from the daily-digest cron. Finds users whose next lifecycle
 * stage is due and sends exactly one email each.
 */
export async function processLifecycleEmails(limit = BATCH): Promise<number> {
  const now = Date.now()
  const oldest = new Date(now - (DUE_AFTER_HOURS.day7 + 48) * 3600_000)

  // Only users young enough to still have a stage pending.
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: oldest }, email: { not: null } },
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: limit * 4,
  })
  if (users.length === 0) return 0

  const sentRows = await prisma.analyticsEvent.findMany({
    where: { event: MARKER, userId: { in: users.map((u) => u.id) } },
    select: { userId: true, properties: true },
  })
  const sentByUser = new Map<string, Set<string>>()
  for (const row of sentRows) {
    const stage = (row.properties as { stage?: string } | null)?.stage
    if (!row.userId || !stage) continue
    if (!sentByUser.has(row.userId)) sentByUser.set(row.userId, new Set())
    sentByUser.get(row.userId)!.add(stage)
  }

  let sent = 0
  for (const u of users) {
    if (sent >= limit) break
    if (!u.email) continue
    const done = sentByUser.get(u.id) ?? new Set<string>()
    const ageHours = (now - u.createdAt.getTime()) / 3600_000

    // Most-recent due stage first: if the cron was down we do not spam a
    // backlog, we send the one that is currently most relevant.
    const due = (['day7', 'day3', 'day1'] as const).find(
      (s) => ageHours >= DUE_AFTER_HOURS[s] && !done.has(s),
    )
    if (!due) continue

    const [applications, replies, resumes] = await Promise.all([
      prisma.jobApplication.count({ where: { userId: u.id } }),
      prisma.inboxMessage.count({ where: { userId: u.id } }).catch(() => 0),
      prisma.resume.count({ where: { userId: u.id } }),
    ])

    // Skip a stage whose content no longer applies rather than sending
    // something that reads as if nobody is paying attention.
    if (due === 'day1' && resumes > 0) {
      await trackEvent({ event: MARKER, userId: u.id, properties: { stage: due, skipped: 'has_resume' } }).catch(() => {})
      continue
    }

    if (await sendStage(u.id, u.email, due, { name: u.name ?? '', applications, replies, resumes })) {
      sent++
    }
  }
  return sent
}
