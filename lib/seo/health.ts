/**
 * lib/seo/health.ts — daily SEO health check + weekly IndexNow push (B1).
 *
 * Health check: fetches our own sitemap, requests every listed URL (bounded
 * concurrency, shared keep-alive pool so the VPS per-IP connection limiter
 * never trips), and alerts the founder's Telegram when a page 404s/500s or
 * the sitemap itself breaks.
 *
 * IndexNow push: submits the full URL list to the IndexNow network weekly
 * (Bing/Yandex & friends). Google has no ping API anymore — its discovery
 * runs off sitemap lastmod + Search Console (owner-gated).
 *
 * Both are driven from the hourly daily-digest cron (no new GitHub workflow
 * possible — deploy token lacks the workflow scope) and are deduped via
 * AnalyticsEvent markers, same pattern as the weekly metrics snapshot.
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { sendAdminAlert } from '@/lib/alerts'
import { prisma } from '@/lib/prisma'
import { getSitemapUrls, submitIndexNow } from '@/lib/seo/indexnow'

const CONCURRENCY = 5

export interface SeoHealthReport {
  checked: number
  failures: { url: string; status: number }[]
  sitemapError: string | null
}

export async function runSeoHealthCheck(): Promise<SeoHealthReport> {
  let urls: string[]
  try {
    urls = await getSitemapUrls()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await sendAdminAlert(`SEO health: sitemap.xml is BROKEN\n${message}`, 'seo-health:sitemap')
    return { checked: 0, failures: [], sitemapError: message }
  }

  const failures: { url: string; status: number }[] = []
  const queue = [...urls]

  async function workerLoop(): Promise<void> {
    for (;;) {
      const url = queue.shift()
      if (!url) return
      try {
        const res = await fetch(url, { redirect: 'follow', cache: 'no-store' })
        if (res.status >= 400) failures.push({ url, status: res.status })
        // Drain the body so undici can reuse the pooled connection.
        await res.arrayBuffer().catch(() => {})
      } catch {
        failures.push({ url, status: 0 })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => workerLoop()))

  if (failures.length > 0) {
    const sample = failures
      .slice(0, 8)
      .map((f) => `${f.status || 'ERR'} ${f.url}`)
      .join('\n')
    await sendAdminAlert(
      `SEO health: ${failures.length}/${urls.length} sitemap URLs failing\n${sample}`,
      'seo-health:pages',
    )
  }

  return { checked: urls.length, failures, sitemapError: null }
}

async function alreadyRan(event: string, withinHours: number): Promise<boolean> {
  const row = await prisma.analyticsEvent.findFirst({
    where: { event, createdAt: { gte: new Date(Date.now() - withinHours * 3600_000) } },
    select: { id: true },
  })
  return row !== null
}

/**
 * Called from the hourly daily-digest cron. Self-gates:
 *  - health check: daily, 06-11 UTC window
 *  - IndexNow full-sitemap push: Mondays in the same window
 */
export async function maybeRunSeoAutomation(): Promise<'ran' | 'skipped'> {
  const now = new Date()
  const hour = now.getUTCHours()
  if (hour < 6 || hour > 11) return 'skipped'
  if (await alreadyRan('seo_health_ran', 20)) return 'skipped'

  const report = await runSeoHealthCheck()

  let indexnow: { submitted: number; ok: boolean } | null = null
  if (now.getUTCDay() === 1 && report.sitemapError === null) {
    try {
      const urls = await getSitemapUrls()
      indexnow = await submitIndexNow(urls)
    } catch (err) {
      console.warn('[seo] indexnow weekly push failed:', err)
    }
  }

  await trackEvent({
    event: 'seo_health_ran',
    properties: {
      checked: report.checked,
      failures: report.failures.length,
      sitemapError: report.sitemapError,
      ...(indexnow ? { indexnowSubmitted: indexnow.submitted, indexnowOk: indexnow.ok } : {}),
    },
  }).catch(() => {})

  return 'ran'
}
