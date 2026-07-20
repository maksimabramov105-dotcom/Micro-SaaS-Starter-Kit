/**
 * lib/ops/daily-pulse.ts — the founder's morning Telegram pulse (Session D1).
 *
 * One message at ~9am Sydney with YESTERDAY's numbers: visitors (+ top
 * referrers/landing pages), leads, tripwire sales + revenue, new subs + MRR,
 * applications submitted/failed, and the top error bucket if any.
 *
 * Driven from the hourly daily-digest cron (no new GitHub workflow possible —
 * deploy token lacks the workflow scope), self-gated to 9am Sydney and deduped
 * via an AnalyticsEvent marker so a delayed/repeated cron fires it once a day.
 */
import { sendAdminMessage } from '@/lib/alerts'
import { trackEvent } from '@/lib/analytics-advanced'
import { getRevenueMetrics } from '@/lib/pmf/queries'
import { prisma } from '@/lib/prisma'

const TZ = 'Australia/Sydney'

/** Minutes that Sydney wall-clock is ahead of UTC at instant `d` (DST-aware). */
function sydneyOffsetMinutes(d: Date): number {
  const syd = new Date(d.toLocaleString('en-US', { timeZone: TZ }))
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((syd.getTime() - utc.getTime()) / 60000)
}

export function currentSydneyHour(now: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now),
    10,
  ) % 24
}

/** The most recent full Sydney calendar day, as a UTC [start, end) window. */
export function sydneyYesterdayWindow(now: Date = new Date()): { start: Date; end: Date; label: string } {
  const off = sydneyOffsetMinutes(now)
  // Shift so UTC getters read Sydney wall-clock, then truncate to Sydney midnight.
  const sydWall = new Date(now.getTime() + off * 60000)
  const todayMidnightWall = Date.UTC(sydWall.getUTCFullYear(), sydWall.getUTCMonth(), sydWall.getUTCDate())
  const end = new Date(todayMidnightWall - off * 60000) // Sydney today 00:00 as a real UTC instant
  const start = new Date(end.getTime() - 24 * 3600_000)
  const label = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(end.getTime() - 12 * 3600_000))
  return { start, end, label }
}

const SENT_STATUSES = ['SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED'] as const
const TRIPWIRE_PRICE_CENTS = 499

function topN(items: (string | null)[], n: number, drop: (s: string) => boolean): [string, number][] {
  const counts = new Map<string, number>()
  for (const raw of items) {
    const s = (raw ?? '').trim()
    if (!s || drop(s)) continue
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function bucketError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('captcha') || m.includes('challenge') || m.includes('cloudflare')) return 'bot walls (CAPTCHA)'
  if (m.includes('timeout') || m.includes('timed out')) return 'form timeouts'
  if (m.includes('404') || m.includes('not found') || m.includes('closed') || m.includes('expired')) return 'stale/closed postings'
  if (m.includes('field') || m.includes('required') || m.includes('validation')) return 'unexpected required fields'
  if (m.includes('login') || m.includes('auth')) return 'login-walled applications'
  return 'other automation failures'
}

export async function buildDailyPulse(now: Date = new Date()): Promise<{ title: string; text: string }> {
  const { start, end, label } = sydneyYesterdayWindow(now)
  const win = { gte: start, lt: end }

  const [pageViews, leads, tripwireOrders, newSubs, apps, failedRows, revenue] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { event: 'page_view', createdAt: win },
      select: { sessionId: true, page: true, referrer: true },
    }),
    prisma.analyticsEvent.count({ where: { event: 'lead_captured', createdAt: win } }),
    prisma.rescueOrder.count({
      where: { paymentIntentId: { not: null }, paidAt: win, status: { in: ['PAID', 'GENERATING', 'DELIVERED'] } },
    }),
    prisma.user.count({ where: { firstPaidAt: win } }),
    prisma.jobApplication.groupBy({ by: ['status'], where: { createdAt: win }, _count: { _all: true } }),
    prisma.jobApplication.findMany({
      where: { status: 'FAILED', createdAt: win, errorMessage: { not: null } },
      select: { errorMessage: true },
    }),
    getRevenueMetrics(),
  ])

  const uniqueVisitors = new Set(pageViews.map((p) => p.sessionId).filter(Boolean)).size
  const topPages = topN(pageViews.map((p) => p.page), 3, () => false)
  const topReferrers = topN(
    pageViews.map((p) => p.referrer),
    3,
    (s) => s.includes('resumeai-bot.ru') || s === 'direct',
  )
  const submitted = apps.filter((a) => (SENT_STATUSES as readonly string[]).includes(a.status)).reduce((s, a) => s + a._count._all, 0)
  const failed = apps.find((a) => a.status === 'FAILED')?._count._all ?? 0
  const errorBuckets = topN(failedRows.map((f) => bucketError(f.errorMessage ?? '')), 1, () => false)

  const usd = (c: number) => `$${(c / 100).toFixed(2)}`
  const lines: string[] = [
    `Yesterday (${label}, Sydney)`,
    '',
    `Visitors        ${uniqueVisitors} unique`,
  ]
  if (topPages.length) lines.push(`  top pages     ${topPages.map(([p, c]) => `${p} (${c})`).join(', ').slice(0, 120)}`)
  if (topReferrers.length) lines.push(`  top referrers ${topReferrers.map(([r, c]) => `${r} (${c})`).join(', ').slice(0, 120)}`)
  lines.push(
    '',
    `Leads captured  ${leads}`,
    `Tripwire sales  ${tripwireOrders}  (${usd(tripwireOrders * TRIPWIRE_PRICE_CENTS)})`,
    `New subs        ${newSubs}`,
    `MRR (now)       ${usd(revenue.mrrCents)}  ·  ${revenue.payingCustomers} paying`,
    `Applications    ${submitted} submitted, ${failed} failed`,
  )
  if (errorBuckets.length) lines.push(`Top error       ${errorBuckets[0][0]} (${errorBuckets[0][1]})`)

  return { title: 'ResumeAI daily pulse', text: lines.join('\n') }
}

/** Called from the hourly digest cron. Fires once/day at 9am Sydney. */
export async function maybeSendDailyPulse(now: Date = new Date()): Promise<'sent' | 'skipped'> {
  if (currentSydneyHour(now) !== 9) return 'skipped'

  const already = await prisma.analyticsEvent.findFirst({
    where: { event: 'daily_pulse_sent', createdAt: { gte: new Date(now.getTime() - 20 * 3600_000) } },
    select: { id: true },
  })
  if (already) return 'skipped'

  const pulse = await buildDailyPulse(now)
  const sent = await sendAdminMessage(pulse.text, {
    title: pulse.title,
    emoji: '\u{1F4CA}', // 📊
    key: `daily-pulse:${new Date(now).toISOString().slice(0, 10)}`,
    dedupeSeconds: 20 * 3600,
  })
  if (sent) await trackEvent({ event: 'daily_pulse_sent', properties: {} }).catch(() => {})
  return sent ? 'sent' : 'skipped'
}
