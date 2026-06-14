/**
 * lib/notifications/follow-up.ts
 *
 * No-response follow-up nudges. Most recruiter replies arrive in 1-3 weeks, but
 * applications that go quiet are where candidates can still act (a short note to
 * the hiring manager measurably lifts reply rates). This finds applications that
 * were submitted N+ days ago with no response, and sends the user ONE honest
 * nudge per application (deduped via a `followup_nudged` ApplicationEvent).
 *
 * Honest by design (FTC): we never promise an interview or a reply — we surface
 * quiet applications and suggest concrete, optional next steps.
 */
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

const FOLLOWUP_AFTER_DAYS = Number(process.env.FOLLOWUP_AFTER_DAYS ?? 7)
const MAX_APPS_PER_EMAIL = 8

export interface FollowUpResult {
  candidates: number       // stale applications found
  usersNotified: number
  appsNudged: number
  dryRun: boolean
}

interface StaleApp {
  id: string
  userId: string
  jobTitle: string
  company: string
  appliedAt: Date | null
  user: { email: string; name: string | null }
}

function daysAgo(d: Date | null, now: Date): number {
  if (!d) return 0
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000)
}

function buildEmail(name: string | null, apps: StaleApp[], now: Date): { subject: string; html: string } {
  const first = name?.split(' ')[0] || 'there'
  const rows = apps
    .map(
      (a) =>
        `<li style="margin-bottom:6px"><strong>${escapeHtml(a.jobTitle)}</strong> at ${escapeHtml(a.company)} — sent ${daysAgo(a.appliedAt, now)} days ago</li>`,
    )
    .join('')
  const subject =
    apps.length === 1
      ? `1 application worth a quick follow-up`
      : `${apps.length} applications worth a quick follow-up`
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.6;color:#0f172a">
    <h2 style="color:#065f46">Hi ${escapeHtml(first)}, a few applications have gone quiet</h2>
    <p>These were submitted over ${FOLLOWUP_AFTER_DAYS} days ago and haven't had a reply yet. That's
    completely normal — most recruiter replies come in 1-3 weeks — but a short, polite
    follow-up is one of the few things that genuinely lifts your odds:</p>
    <ol style="padding-left:18px">${rows}</ol>
    <p style="margin-top:16px"><strong>Optional next steps that actually help:</strong></p>
    <ul style="padding-left:18px">
      <li>Find the hiring manager or a recruiter for the role on LinkedIn and send a 2-3 sentence note: you applied, you're excited about the role, here's the one thing that makes you a fit.</li>
      <li>Re-check the job is still open — if it's closed, move on without spending more energy on it.</li>
      <li>Keep your auto-apply running so fresh, eligible roles keep flowing while you follow up.</li>
    </ul>
    <p style="color:#475569;font-size:13px;margin-top:18px">We don't promise interviews — recruiters
    decide that. We just make sure you only apply where you're eligible, and we tell you when it's
    worth a nudge.</p>
    <p style="color:#94a3b8;font-size:12px">You're getting this because you have active applications on resumeai-bot.ru.</p>
  </div>`
  return { subject, html }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/**
 * Find stale, un-nudged applications and (unless dryRun) email each user once
 * and mark those applications as nudged so they are never nudged twice.
 */
export async function runFollowUpNudges(opts?: { now?: Date; dryRun?: boolean }): Promise<FollowUpResult> {
  const now = opts?.now ?? new Date()
  const dryRun = opts?.dryRun ?? false
  const cutoff = new Date(now.getTime() - FOLLOWUP_AFTER_DAYS * 86_400_000)

  const stale = (await prisma.jobApplication.findMany({
    where: {
      status: 'SUBMITTED',
      responseAt: null,
      appliedAt: { lte: cutoff, not: null },
      events: { none: { type: 'followup_nudged' } },
    },
    select: {
      id: true, userId: true, jobTitle: true, company: true, appliedAt: true,
      user: { select: { email: true, name: true } },
    },
    orderBy: { appliedAt: 'asc' },
    take: 1000,
  })) as StaleApp[]

  // Group by user.
  const byUser = new Map<string, StaleApp[]>()
  for (const a of stale) {
    if (!a.user?.email) continue
    const list = byUser.get(a.userId) ?? []
    list.push(a)
    byUser.set(a.userId, list)
  }

  let usersNotified = 0
  let appsNudged = 0

  for (const [, apps] of byUser) {
    const batch = apps.slice(0, MAX_APPS_PER_EMAIL)
    if (dryRun) {
      usersNotified++
      appsNudged += batch.length
      continue
    }
    const { subject, html } = buildEmail(batch[0].user.name, batch, now)
    try {
      await sendEmail({ to: batch[0].user.email, subject, html })
    } catch (err) {
      console.error('[follow-up] email failed', { userId: batch[0].userId, err })
      continue // don't mark nudged if we couldn't actually send
    }
    // Mark every app in the batch as nudged so it is never nudged again.
    await prisma.applicationEvent.createMany({
      data: batch.map((a) => ({
        applicationId: a.id,
        type: 'followup_nudged',
        payload: { sentAt: now.toISOString() },
      })),
    })
    usersNotified++
    appsNudged += batch.length
  }

  return { candidates: stale.length, usersNotified, appsNudged, dryRun }
}
