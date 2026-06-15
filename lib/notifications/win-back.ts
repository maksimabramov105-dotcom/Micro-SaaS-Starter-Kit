/**
 * lib/notifications/win-back.ts
 *
 * Win-back re-engagement. Job-seeking is cyclical: people cancel when a search
 * pauses (got an interview, took a break, ran low on budget) and re-enter weeks
 * later. On cancel the Stripe webhook stamps `winBackAt` (= cancel +
 * WIN_BACK_DELAY_DAYS); this cron emails each due user ONCE when that date
 * arrives — but only if they haven't resubscribed in the meantime.
 *
 * Honest by design (FTC): no fake urgency, no invented testimonials. We remind
 * them the account is still there, surface the standing public offer if one is
 * active, and make opting out trivial.
 */
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { isPromoActive, PROMO } from '@/lib/promo'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
const MAX_PER_RUN = 200 // safety cap per run

export interface WinBackResult {
  due: number          // users whose win-back date has arrived
  sent: number
  dryRun: boolean
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export function buildWinBackEmail(name: string | null, now: Date): { subject: string; html: string } {
  const first = name?.split(' ')[0] || 'there'
  const promoActive = isPromoActive(now)
  const offer = promoActive
    ? `<p style="margin:16px 0;padding:12px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px">
         If now's the time, <strong>${escapeHtml(PROMO.discountLabel)}</strong> is still on with code
         <strong>${escapeHtml(PROMO.code)}</strong>.</p>`
    : ''
  const subject = `Back on the job hunt, ${escapeHtml(first)}?`
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.6;color:#0f172a">
    <h2 style="color:#065f46">Your ResumeAI account is still here</h2>
    <p>Hi ${escapeHtml(first)}, it's been a few weeks since you paused your ResumeAI plan. Job searches
    rarely run in a straight line — so if you're back at it, your resumes, campaigns and inbox are exactly
    where you left them.</p>
    <p>What you get the moment you restart:</p>
    <ul style="padding-left:18px">
      <li>Auto-apply only to roles you're actually eligible for — we never burn an application you can't win.</li>
      <li>A resume tailored to each role, with proof every submission really went through.</li>
      <li>Every recruiter reply in one inbox.</li>
    </ul>
    ${offer}
    <p style="margin-top:18px">
      <a href="${SITE}/pricing" style="background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Pick up where you left off</a>
    </p>
    <p style="color:#475569;font-size:13px;margin-top:18px">No pressure and no tricks — if you've landed
    something, congratulations, and ignore this. We'd love to hear you got the job.</p>
    <p style="color:#94a3b8;font-size:12px">You're getting this once because you were a ResumeAI subscriber.
    Reply "stop" and we won't send another.</p>
  </div>`
  return { subject, html }
}

/**
 * Find users whose win-back date has arrived and who have NOT resubscribed, and
 * (unless dryRun) email each one once and stamp winBackSentAt so it never fires
 * twice for the same cancellation.
 */
export async function runWinBack(opts?: { now?: Date; dryRun?: boolean }): Promise<WinBackResult> {
  const now = opts?.now ?? new Date()
  const dryRun = opts?.dryRun ?? false

  const due = await prisma.user.findMany({
    where: {
      winBackAt: { lte: now, not: null },
      winBackSentAt: null,
      stripeSubscriptionId: null, // did NOT resubscribe — don't win-back active customers
    },
    select: { id: true, email: true, name: true },
    take: MAX_PER_RUN,
  })

  let sent = 0
  if (!dryRun) {
    for (const u of due) {
      if (!u.email) continue
      try {
        const { subject, html } = buildWinBackEmail(u.name, now)
        await sendEmail({ to: u.email, subject, html })
        await prisma.user.update({ where: { id: u.id }, data: { winBackSentAt: now } })
        sent++
      } catch (err) {
        // Best-effort: a send failure shouldn't block the rest. Leave winBackSentAt
        // null so it's retried next run.
        console.error('[win-back] send failed for user', u.id, err)
      }
    }
  }

  return { due: due.length, sent, dryRun }
}
