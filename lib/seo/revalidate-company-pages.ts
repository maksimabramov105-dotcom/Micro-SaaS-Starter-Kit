/**
 * lib/seo/revalidate-company-pages.ts — make statically-built pages reflect the
 * database after a deploy (G1 follow-up, extended for the A/B flags).
 *
 * WHY THIS EXISTS: the Docker image is built with a dummy DATABASE_URL
 * (deploy.yml passes postgresql://x:x@localhost:5432/x), so every
 * /apply-to/{company} page is pre-rendered at build time with
 * `available:false` — i.e. WITHOUT the live role list. Left alone, the
 * enrichment only appears when each page's 6h ISR window lapses, so a fresh
 * deploy serves editorial-only pages for hours.
 *
 * The same is true of any statically-rendered page that reads the database at
 * render time, which now includes / and /pricing — both read their A/B rollout
 * from the FeatureFlag table.
 *
 * Fix: after a deploy (and every ~6h after), mark those routes stale so the
 * next request re-renders them WITH database access. Called from the hourly
 * daily-digest cron — the same self-gated pattern the rest of the scheduled
 * work uses, because the deploy token can't add GitHub workflow files.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { trackEvent } from '@/lib/analytics-advanced'

const MARKER = 'apply_to_revalidated'
const WINDOW_HOURS = 6

/**
 * When this server process started. A deploy replaces the container, so a
 * process whose start time is NEWER than the last revalidation marker is by
 * definition serving freshly-built (DB-less, un-enriched) pages.
 */
const PROCESS_STARTED_AT = new Date()

/**
 * Marks /apply-to and every /apply-to/{company} instance stale so the next
 * request re-renders them with database access.
 *
 * Two triggers, either is enough:
 *   - the 6h refresh window lapsed (keeps open-role counts current), or
 *   - THIS PROCESS is newer than the last marker, i.e. a deploy happened.
 *
 * The deploy trigger matters: without it, a deploy landing inside the 6h window
 * left all 168 pages editorial-only until the window expired — observed live,
 * pages served with zero role links right after a deploy at 10:07 because the
 * marker from 09:56 was still "recent".
 */
export async function maybeRevalidateCompanyPages(): Promise<'ran' | 'skipped'> {
  try {
    const recent = await prisma.analyticsEvent.findFirst({
      where: { event: MARKER, createdAt: { gte: new Date(Date.now() - WINDOW_HOURS * 3600_000) } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    // Skip only if we revalidated recently AND that happened after this process
    // booted (so the pages it marked stale are the ones we're serving now).
    if (recent && recent.createdAt >= PROCESS_STARTED_AT) return 'skipped'

    // Only the FULL-ROUTE cache needs clearing: getOpenRolesSnapshot is a
    // per-render React cache (no persisted data cache), so each regenerated
    // page reads the database fresh. 'page' covers every dynamic instance of
    // the route, not just one company.
    revalidatePath('/apply-to/[company]', 'page')
    revalidatePath('/apply-to')

    // Same failure, different pages: / and /pricing read their A/B flag from
    // the FeatureFlag table, and the build has no database, so both are
    // pre-rendered with the experiment OFF. Turning a flag on in the admin
    // revalidates them (see the flags page), but a DEPLOY re-bakes the flag-off
    // HTML and a container restart reverts to it — observed live on 2026-07-31,
    // when both experiments were enabled and neither page served the variant
    // script until this ran.
    revalidatePath('/')
    revalidatePath('/pricing')

    await trackEvent({ event: MARKER, properties: { windowHours: WINDOW_HOURS } }).catch(() => {})
    return 'ran'
  } catch (err) {
    console.warn('[seo] apply-to revalidation failed (non-fatal):', err)
    return 'skipped'
  }
}
