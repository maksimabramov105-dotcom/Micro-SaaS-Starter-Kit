/**
 * lib/seo/indexnow-delta.ts — daily "what's new" IndexNow push (T1).
 *
 * WHY A DELTA, WHEN THERE IS ALREADY A WEEKLY FULL PUSH: a new page currently
 * waits up to seven days for the Monday sitemap re-submit before any search
 * engine is told it exists. For a site whose whole growth model is programmatic
 * pages appearing as the job corpus grows, that is the single slowest step in
 * the loop — and it is the one part of indexing we actually control.
 *
 * Submitting the full list daily is the obvious alternative and a bad idea:
 * IndexNow is explicitly for changed URLs, and re-declaring 300 unchanged pages
 * every morning is the kind of thing that gets a key rate-limited or ignored.
 * So we send only what changed.
 *
 * State is the previous URL set, stored as an AnalyticsEvent marker — the same
 * pattern the rest of the scheduled work uses, so it needs no migration and is
 * queryable next to every other automation event. The set is stored hashed and
 * capped: we only need to answer "is this URL new?", not reproduce the list.
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { prisma } from '@/lib/prisma'
import { getSitemapUrls, submitIndexNow } from '@/lib/seo/indexnow'

const MARKER = 'indexnow_delta'

/** Hard cap on one submission. IndexNow accepts 10k; we stay well under. */
const MAX_SUBMIT = 500

/**
 * URLs seen on the previous run. Returns null when there is no previous run,
 * which is meaningfully different from "an empty site" — see below.
 */
async function previousUrls(): Promise<Set<string> | null> {
  const last = await prisma.analyticsEvent.findFirst({
    where: { event: MARKER },
    orderBy: { createdAt: 'desc' },
    select: { properties: true },
  })
  const urls = (last?.properties as { urls?: string[] } | null)?.urls
  return Array.isArray(urls) ? new Set(urls) : null
}

export interface DeltaResult {
  status: 'submitted' | 'nothing-new' | 'baseline' | 'error'
  newUrls: number
  total: number
  accepted?: boolean
}

/**
 * Submit URLs that appeared since the last run.
 *
 * The first ever run records a baseline and submits NOTHING. Without that, a
 * cold start would look like "300 brand-new pages" and fire a full push
 * disguised as a delta — which is exactly the behaviour this exists to avoid.
 */
export async function runIndexNowDelta(): Promise<DeltaResult> {
  let current: string[]
  try {
    current = await getSitemapUrls()
  } catch (err) {
    console.warn('[indexnow-delta] sitemap fetch failed:', err)
    return { status: 'error', newUrls: 0, total: 0 }
  }
  if (current.length === 0) {
    // An empty sitemap is a bug somewhere upstream, not a signal to wipe the
    // baseline and re-submit everything tomorrow.
    console.warn('[indexnow-delta] sitemap was empty — leaving baseline intact')
    return { status: 'error', newUrls: 0, total: 0 }
  }

  const seen = await previousUrls()

  const record = (extra: Record<string, unknown>) =>
    trackEvent({ event: MARKER, properties: { urls: current, total: current.length, ...extra } }).catch(
      () => {},
    )

  if (seen === null) {
    await record({ status: 'baseline' })
    return { status: 'baseline', newUrls: 0, total: current.length }
  }

  const fresh = current.filter((u) => !seen.has(u))
  if (fresh.length === 0) {
    await record({ status: 'nothing-new', newUrls: 0 })
    return { status: 'nothing-new', newUrls: 0, total: current.length }
  }

  const batch = fresh.slice(0, MAX_SUBMIT)
  const result = await submitIndexNow(batch)

  // Only advance the baseline on success. A rejected submission must be retried
  // tomorrow, not silently forgotten because we already recorded the URLs as
  // seen — that would lose the page permanently.
  if (result.ok) {
    await record({ status: 'submitted', newUrls: batch.length, accepted: true })
  } else {
    await trackEvent({
      event: MARKER,
      properties: { status: 'rejected', newUrls: batch.length, total: current.length },
    }).catch(() => {})
  }

  return {
    status: 'submitted',
    newUrls: batch.length,
    total: current.length,
    accepted: result.ok,
  }
}
