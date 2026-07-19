/**
 * lib/pmf/weekly-snapshot.ts — the founder's weekly metrics email (P0.5).
 *
 * Composes a plain-text snapshot of the numbers the MASTER_PLAN goals are
 * judged by: signups, activations (G1), week-2 retention (decision gate),
 * MRR (G3), plus funnel conversion. Sent every Monday from the hourly
 * daily-digest cron (see app/api/cron/daily-digest/route.ts) to ADMIN_EMAILS.
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { sendEmail } from '@/lib/email'
import { getRevenueMetrics } from '@/lib/pmf/queries'
import { getRevenueFunnel } from '@/lib/pmf/revenue-funnel'
import { getUserFunnel, getWeek2Retention } from '@/lib/pmf/user-funnel'
import { prisma } from '@/lib/prisma'

const WEEK_MS = 7 * 86_400_000

function pctOrDash(x: number | null): string {
  return x === null ? '-' : `${Math.round(x * 100)}%`
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export interface WeeklySnapshot {
  subject: string
  text: string
}

export async function buildWeeklySnapshot(): Promise<WeeklySnapshot> {
  const [week, retention, revenue, sprint] = await Promise.all([
    getUserFunnel(new Date(Date.now() - WEEK_MS)),
    getWeek2Retention(),
    getRevenueMetrics(),
    getRevenueFunnel(new Date(Date.now() - WEEK_MS)),
  ])

  const lines = [
    `ResumeAI weekly metrics — ${new Date().toISOString().slice(0, 10)}`,
    '',
    'Last 7 days:',
    `  Unique visitors        ${week.landing_view}`,
    `  Signups                ${week.signup}`,
    `  Onboarded (>=1 resume) ${week.onboarding_complete}`,
    `  Activated (G1 metric)  ${week.first_application}`,
    `  New subscribers        ${week.subscribed}`,
    '',
    'Conversion (7d):',
    `  visit -> signup        ${pctOrDash(week.conversion.visitToSignup)}`,
    `  signup -> activated    ${pctOrDash(week.conversion.signupToActivated)} (Phase 4 target >=40%)`,
    `  activated -> paid      ${pctOrDash(week.conversion.activatedToPaid)}`,
    '',
    'Week-2 retention (decision-gate metric):',
    `  cohort (signed up 14-28d ago)  ${retention.cohortSize}`,
    `  active in their week 2        ${retention.retained} (${pctOrDash(retention.rate)})`,
    '',
    'Revenue Sprint funnel (7d · capture -> convert):',
    `  SEO visits             ${sprint.seoVisit}`,
    `  Fit checks started     ${sprint.fitcheckStarted}`,
    `  Leads captured         ${sprint.leadCaptured}`,
    `  Tripwire paid ($4.99)  ${sprint.tripwirePaid}`,
    `  Pro subscribed         ${sprint.proSubscribed}`,
    `  Leads in nurture (now) ${sprint.revenue.activeLeadsInNurture}`,
    '',
    'Revenue (now):',
    `  Subscription MRR       ${dollars(revenue.mrrCents)} (G3 target $10k)`,
    `  Tripwire gross (7d)    ${dollars(sprint.revenue.tripwireGrossCents)} (${sprint.tripwirePaid} orders)`,
    `  Paying customers       ${revenue.payingCustomers} (G2 target 10)`,
    `  Churned MRR (30d)      ${dollars(revenue.churnedMrrCents)}`,
    '',
    `Full report: npx tsx scripts/funnel_report.ts 7 (or /admin/pmf)`,
  ]

  return {
    subject: `ResumeAI weekly: ${week.signup} signups, ${week.first_application} activated, ${dollars(revenue.mrrCents)} MRR`,
    text: lines.join('\n'),
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Send the weekly snapshot to ADMIN_EMAILS if it is due.
 *
 * Called from the HOURLY daily-digest cron (no separate workflow needed — the
 * available deploy token cannot create new GitHub workflows). Self-gates to
 * Monday 09-12 UTC and dedupes via a `weekly_snapshot_sent` AnalyticsEvent so
 * delayed or repeated cron firings send exactly one email per week.
 */
export async function maybeSendWeeklySnapshot(): Promise<'sent' | 'skipped'> {
  const now = new Date()
  if (now.getUTCDay() !== 1) return 'skipped'
  const hour = now.getUTCHours()
  if (hour < 9 || hour > 12) return 'skipped'

  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  if (admins.length === 0) return 'skipped'

  const already = await prisma.analyticsEvent.findFirst({
    where: {
      event: 'weekly_snapshot_sent',
      createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
    },
    select: { id: true },
  })
  if (already) return 'skipped'

  const snap = await buildWeeklySnapshot()
  const html = `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.5">${escapeHtml(snap.text)}</pre>`
  await Promise.all(admins.map((to) => sendEmail({ to, subject: snap.subject, html })))
  await trackEvent({ event: 'weekly_snapshot_sent', properties: { recipients: admins.length } })
  return 'sent'
}
