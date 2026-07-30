/**
 * lib/seo/revalidate-company-pages.ts — keep the live open-role enrichment
 * actually visible (G1 follow-up).
 *
 * WHY THIS EXISTS: the Docker image is built with a dummy DATABASE_URL
 * (deploy.yml passes postgresql://x:x@localhost:5432/x), so every
 * /apply-to/{company} page is pre-rendered at build time with
 * `available:false` — i.e. WITHOUT the live role list. Left alone, the
 * enrichment only appears when each page's 6h ISR window lapses, so a fresh
 * deploy serves editorial-only pages for hours.
 *
 * Fix: after a deploy (and every ~6h after), mark the apply-to routes stale so
 * the next request re-renders them WITH database access. Called from the hourly
 * daily-digest cron — the same self-gated pattern the rest of the scheduled
 * work uses, because the deploy token can't add GitHub workflow files.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { trackEvent } from '@/lib/analytics-advanced'

const MARKER = 'apply_to_revalidated'
const WINDOW_HOURS = 6

/**
 * Marks /apply-to and every /apply-to/{company} instance stale. Returns
 * 'skipped' when it already ran inside the window, so the hourly cron doesn't
 * re-render 168 pages every tick.
 */
export async function maybeRevalidateCompanyPages(): Promise<'ran' | 'skipped'> {
  try {
    const recent = await prisma.analyticsEvent.findFirst({
      where: { event: MARKER, createdAt: { gte: new Date(Date.now() - WINDOW_HOURS * 3600_000) } },
      select: { id: true },
    })
    if (recent) return 'skipped'

    // 'page' revalidates every dynamic instance of the route, not just one.
    revalidatePath('/apply-to/[company]', 'page')
    revalidatePath('/apply-to')

    await trackEvent({ event: MARKER, properties: { windowHours: WINDOW_HOURS } }).catch(() => {})
    return 'ran'
  } catch (err) {
    console.warn('[seo] apply-to revalidation failed (non-fatal):', err)
    return 'skipped'
  }
}
