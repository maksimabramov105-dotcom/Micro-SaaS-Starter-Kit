/**
 * lib/pmf/traffic.ts — the traffic half of the weekly growth report (T4).
 *
 * The weekly snapshot already covered the funnel and the money well. What it
 * could not answer was the first question you ask about a growth loop: where
 * did the people come from, and is search actually starting to work? Without
 * that, "12 signups" is a number with no attribution and no trend, so nothing
 * about the SEO investment is falsifiable.
 *
 * Everything here is computed from AnalyticsEvent rows we already write — no
 * new tracking, no third-party script, no cookie banner implications.
 *
 * Google Search Console lines are passed in by the caller (see lib/seo/gsc.ts).
 * They are the only signal that answers "is Google SHOWING these pages" —
 * referrers see clicks only, and a page can rank for weeks before it is clicked.
 */
import { prisma } from '@/lib/prisma'

export type Source = 'organic' | 'social' | 'referral' | 'direct'

/** Classify a referrer string into a traffic source. */
export function classifySource(referrer: string | null | undefined): Source {
  const r = (referrer ?? '').toLowerCase().trim()
  if (!r) return 'direct'
  let host = r
  try {
    host = new URL(r).hostname.toLowerCase()
  } catch {
    // Not a URL — treat the raw value as the host.
  }
  if (host.includes('resumeai-bot.')) return 'direct' // our own pages
  const SEARCH = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.', 'ecosia.', 'brave.']
  if (SEARCH.some((s) => host.includes(s))) return 'organic'
  const SOCIAL = [
    'reddit.', 'x.com', 'twitter.', 't.co', 'linkedin.', 'lnkd.in', 'facebook.',
    'instagram.', 'youtube.', 'news.ycombinator.', 'discord.', 'producthunt.',
  ]
  if (SOCIAL.some((s) => host.includes(s))) return 'social'
  return 'referral'
}

export interface TrafficSnapshot {
  bySource: Record<Source, number>
  total: number
  /** Landing pages ranked by how often a visit led to a fit check or lead. */
  bestPage: { page: string; visits: number; converted: number; rate: number } | null
  /** Most frequent non-200 the site actually served, if any were recorded. */
  worstError: { page: string; count: number } | null
  indexedPages: number | null
}

const CONVERSION_EVENTS = ['fitcheck_started', 'lead_captured', 'checkout_started', 'tripwire_paid']

export async function getTrafficSnapshot(days = 7, sitemapCount?: number): Promise<TrafficSnapshot> {
  const since = new Date(Date.now() - days * 24 * 3600_000)

  const [visits, conversions, errors] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: since }, event: { in: ['landing_view', 'page_view', 'seo_visit'] } },
      select: { referrer: true, page: true, sessionId: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: since }, event: { in: CONVERSION_EVENTS } },
      select: { sessionId: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: since }, event: 'page_error' },
      select: { page: true },
    }),
  ])

  // Count unique sessions per source, not raw events: ten page views from one
  // visitor is one visit, and counting events would flatter organic most.
  const seen = new Map<string, Source>()
  for (const v of visits) {
    const key = v.sessionId ?? `anon:${v.page ?? ''}:${v.referrer ?? ''}`
    if (!seen.has(key)) seen.set(key, classifySource(v.referrer))
  }
  const bySource: Record<Source, number> = { organic: 0, social: 0, referral: 0, direct: 0 }
  for (const s of seen.values()) bySource[s] += 1

  // Best landing page by conversion RATE, with a floor so a page with one visit
  // and one conversion does not outrank the page carrying real volume.
  const convertedSessions = new Set(conversions.map((c) => c.sessionId).filter(Boolean) as string[])
  const perPage = new Map<string, { visits: number; converted: number }>()
  for (const v of visits) {
    const page = v.page ?? '/'
    const row = perPage.get(page) ?? { visits: 0, converted: 0 }
    row.visits += 1
    if (v.sessionId && convertedSessions.has(v.sessionId)) row.converted += 1
    perPage.set(page, row)
  }
  const MIN_VISITS = 5
  const ranked = [...perPage.entries()]
    .filter(([, r]) => r.visits >= MIN_VISITS)
    .map(([page, r]) => ({ page, ...r, rate: r.converted / r.visits }))
    .sort((a, b) => b.rate - a.rate || b.visits - a.visits)

  const errCount = new Map<string, number>()
  for (const e of errors) errCount.set(e.page ?? '?', (errCount.get(e.page ?? '?') ?? 0) + 1)
  const worstErr = [...errCount.entries()].sort((a, b) => b[1] - a[1])[0]

  return {
    bySource,
    total: seen.size,
    bestPage: ranked[0] ?? null,
    worstError: worstErr ? { page: worstErr[0], count: worstErr[1] } : null,
    indexedPages: sitemapCount ?? null,
  }
}

/** Render the traffic block for the weekly report. Phone-readable. */
export function formatTrafficBlock(
  t: TrafficSnapshot,
  prev?: TrafficSnapshot,
  gscLines: string[] = ['  GSC impressions       unavailable'],
): string[] {
  const wow = (now: number, before: number | undefined) => {
    if (before === undefined || before === 0) return ''
    const d = Math.round(((now - before) / before) * 100)
    return ` (${d >= 0 ? '+' : ''}${d}% WoW)`
  }
  const lines = [
    'Traffic (7d, unique visits):',
    `  Organic (search)       ${t.bySource.organic}${wow(t.bySource.organic, prev?.bySource.organic)}`,
    `  Direct                 ${t.bySource.direct}${wow(t.bySource.direct, prev?.bySource.direct)}`,
    `  Referral               ${t.bySource.referral}`,
    `  Social                 ${t.bySource.social}`,
    `  Total                  ${t.total}${wow(t.total, prev?.total)}`,
  ]
  if (t.indexedPages !== null) lines.push(`  Pages in sitemap       ${t.indexedPages}`)
  lines.push(...gscLines)
  if (t.bestPage) {
    lines.push(
      `  Best-converting page   ${t.bestPage.page} (${Math.round(t.bestPage.rate * 100)}% of ${t.bestPage.visits})`,
    )
  }
  if (t.worstError) {
    lines.push(`  Most frequent error    ${t.worstError.page} (${t.worstError.count}x)`)
  }
  return lines
}
