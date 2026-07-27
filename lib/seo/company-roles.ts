/**
 * lib/seo/company-roles.ts — live open-role data for the /apply-to pages (G1).
 *
 * One query, bucketed in memory, cached for 6h. Every /apply-to/{company} page
 * and the sitemap read from the SAME cached map, so "open roles", the sample
 * role list, the remote-policy line, and the skip-thin-pages decision are all
 * derived from one consistent snapshot of the scraper cache (JobListing) that
 * the existing crons refresh — zero manual work keeps the pages current.
 *
 * Thin-page rule (G1): a company whose board currently returns 0 cached roles
 * gets no page and no sitemap entry — its page would be shared ATS boilerplate
 * plus a name, which is exactly the duplicate/thin content we don't want.
 *
 * Build safety: if the DB is unreachable (a CI/Docker build without prod DB
 * access), `available` is false and callers MUST NOT skip anything — otherwise
 * a DB-less build would pre-render the entire section as 404s. We only skip a
 * company when the DB answered AND it genuinely has 0 roles.
 */
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { APPLY_COMPANIES, jobUrlMatcher, type ApplyCompany } from '@/lib/seo/apply-companies'

export interface CompanyRole {
  title: string
  url: string
  location: string | null
  remote: boolean
}

export interface CompanyRoles {
  count: number
  remoteCount: number
  /** Up to SAMPLE_LIMIT roles for on-page display (most recent first). */
  sample: CompanyRole[]
}

export interface OpenRolesSnapshot {
  /** False when the JobListing query failed — callers must not skip on this. */
  available: boolean
  byCompany: Map<string, CompanyRoles>
}

const SAMPLE_LIMIT = 8

/**
 * Pull the cached listings once and bucket them onto every curated company by
 * matching JobListing.url against the company's board matcher. Doing this in
 * one pass beats 168 `contains` count queries.
 */
async function buildSnapshot(): Promise<OpenRolesSnapshot> {
  const byCompany = new Map<string, CompanyRoles>()
  try {
    const listings = await prisma.jobListing.findMany({
      select: { title: true, url: true, location: true, remote: true },
      orderBy: { scrapedAt: 'desc' },
    })

    // Pre-compute each company's matcher once.
    const matchers: { company: ApplyCompany; matcher: string }[] = APPLY_COMPANIES.map((c) => ({
      company: c,
      matcher: jobUrlMatcher(c),
    }))

    for (const l of listings) {
      const url = l.url ?? ''
      for (const { company, matcher } of matchers) {
        if (!url.includes(matcher)) continue
        let bucket = byCompany.get(company.slug)
        if (!bucket) {
          bucket = { count: 0, remoteCount: 0, sample: [] }
          byCompany.set(company.slug, bucket)
        }
        bucket.count += 1
        if (l.remote) bucket.remoteCount += 1
        if (bucket.sample.length < SAMPLE_LIMIT) {
          bucket.sample.push({ title: l.title, url: l.url, location: l.location, remote: l.remote })
        }
        break // a listing belongs to at most one curated company
      }
    }

    return { available: true, byCompany }
  } catch {
    // DB unreachable — signal "don't skip anything", never an empty section.
    return { available: false, byCompany }
  }
}

/** Cached 6h so 168 statically-generated pages share one query per window. */
export const getOpenRolesSnapshot = unstable_cache(buildSnapshot, ['apply-to-open-roles'], {
  revalidate: 21600,
  tags: ['open-roles'],
})

/** Roles for one company, or null. `available:false` snapshots yield null too. */
export function companyRoles(snap: OpenRolesSnapshot, slug: string): CompanyRoles | null {
  return snap.byCompany.get(slug) ?? null
}

/**
 * Should this company get a page / sitemap entry right now?
 * Only skip when the DB answered and the company genuinely has 0 roles.
 */
export function companyHasPage(snap: OpenRolesSnapshot, slug: string): boolean {
  if (!snap.available) return true
  const roles = snap.byCompany.get(slug)
  return !!roles && roles.count > 0
}

/** Slugs to publish, and the ones skipped as thin (for logging/reporting). */
export function partitionCompanies(snap: OpenRolesSnapshot): {
  published: ApplyCompany[]
  skipped: ApplyCompany[]
} {
  if (!snap.available) return { published: [...APPLY_COMPANIES], skipped: [] }
  const published: ApplyCompany[] = []
  const skipped: ApplyCompany[] = []
  for (const c of APPLY_COMPANIES) {
    if (companyHasPage(snap, c.slug)) published.push(c)
    else skipped.push(c)
  }
  return { published, skipped }
}
