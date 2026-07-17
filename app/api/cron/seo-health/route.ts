/**
 * POST /api/cron/seo-health — on-demand SEO health check + IndexNow push (B1).
 *
 * The scheduled path runs from the hourly daily-digest cron via
 * maybeRunSeoAutomation(); this route exists for manual triggers and future
 * dedicated scheduling. Auth: Bearer CRON_SECRET.
 *
 * Body (optional): { "indexnow": true } to force a full-sitemap IndexNow
 * submission regardless of weekday.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSitemapUrls, submitIndexNow } from '@/lib/seo/indexnow'
import { runSeoHealthCheck } from '@/lib/seo/health'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const report = await runSeoHealthCheck()

  let indexnow = null
  if (body?.indexnow === true && report.sitemapError === null) {
    const urls = await getSitemapUrls()
    indexnow = await submitIndexNow(urls)
  }

  return NextResponse.json({
    checked: report.checked,
    failures: report.failures,
    sitemapError: report.sitemapError,
    indexnow,
  })
}
