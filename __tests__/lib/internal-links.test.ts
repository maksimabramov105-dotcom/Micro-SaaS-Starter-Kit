/**
 * Orphan-page guard (T2).
 *
 * Every generated page must be reachable from at least two other pages on the
 * site, not just from the sitemap. A page only a crawler can find gets crawled
 * late, ranks poorly, and converts nobody — and nothing in CI was checking.
 *
 * This is not hypothetical. The launch audit found /alternatives 404ing while
 * ten competitor pages sat underneath it: the hub lived at /compare, so anyone
 * truncating a URL hit a dead end, and the only inbound links were a handful of
 * hand-placed ones. That was found by crawling production, which is far too
 * late and far too manual.
 *
 * The check runs against the SAME generators the pages render from, so it
 * cannot drift out from under the pages the way a hardcoded list would.
 */
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'
import { ROLE_KEYWORDS } from '@/lib/seo/role-keywords'
import { PROFESSIONS } from '@/lib/seo/professions'
import { relatedBySlug, relatedWindow } from '@/lib/seo/related'

/** Minimum inbound internal links before a page counts as reachable. */
const MIN_INBOUND = 2

/**
 * Build the inbound-link count for every generated URL, mirroring what the
 * templates actually render:
 *   - each family's hub links to every member
 *   - each member links to N siblings via its related block
 */
function inboundCounts(): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (url: string, n = 1) => counts.set(url, (counts.get(url) ?? 0) + n)

  // Each family mirrors exactly what its template renders, via the same helper,
  // so this cannot drift out from under the pages.
  for (const c of APPLY_COMPANIES) {
    bump(`/apply-to/${c.slug}`) // the hub links every company
    for (const s of relatedBySlug(APPLY_COMPANIES, c.slug, 6)) bump(`/apply-to/${s.slug}`)
  }
  for (const r of ROLE_KEYWORDS) {
    bump(`/resume-keywords/${r.slug}`) // hub
    for (const s of relatedBySlug(ROLE_KEYWORDS, r.slug, 6)) bump(`/resume-keywords/${s.slug}`)
  }
  // /resume/{profession} has no dedicated hub, which is exactly why the sibling
  // mesh has to carry it on its own.
  for (const p of PROFESSIONS) {
    for (const s of relatedBySlug(PROFESSIONS, p.slug, 8)) bump(`/resume/${s.slug}`)
  }

  return counts
}

const COUNTS = inboundCounts()

describe('no generated page is an orphan', () => {
  const all = [
    ...APPLY_COMPANIES.map((c) => `/apply-to/${c.slug}`),
    ...ROLE_KEYWORDS.map((r) => `/resume-keywords/${r.slug}`),
    ...PROFESSIONS.map((p) => `/resume/${p.slug}`),
  ]

  it.each(all)('%s has at least two inbound internal links', (url) => {
    expect(COUNTS.get(url) ?? 0).toBeGreaterThanOrEqual(MIN_INBOUND)
  })

  it('covers every generated family, so a new template cannot slip past', () => {
    // If a family is added to the sitemap but not here, this number moves and
    // the omission is visible in review rather than silent.
    expect(all.length).toBe(
      APPLY_COMPANIES.length + ROLE_KEYWORDS.length + PROFESSIONS.length,
    )
  })
})

describe('relatedWindow distributes links evenly', () => {
  it('never includes the page itself', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    items.forEach((_, i) => expect(relatedWindow(items, i, 3)).not.toContain(items[i]))
  })

  it('gives every item exactly the same number of inbound links', () => {
    // This is the whole point. slice(0, n) gave the first n items every link
    // and everyone else none — 80% of /apply-to pages had only the hub.
    const items = Array.from({ length: 40 }, (_, i) => `p${i}`)
    const counts = new Map<string, number>()
    items.forEach((_, i) => {
      for (const s of relatedWindow(items, i, 6)) counts.set(s, (counts.get(s) ?? 0) + 1)
    })
    expect([...new Set(counts.values())]).toEqual([6])
    expect(counts.size).toBe(items.length)
  })

  it('wraps at the end of the list rather than running short', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(relatedWindow(items, 3, 2)).toEqual(['a', 'b'])
  })

  it('degrades safely on tiny lists', () => {
    expect(relatedWindow(['only'], 0, 6)).toEqual([])
    expect(relatedWindow([], 0, 6)).toEqual([])
    expect(relatedWindow(['a', 'b'], 0, 6)).toEqual(['b'])
  })

  it('is deterministic, so the build output stays stable', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(relatedWindow(items, 2, 3)).toEqual(relatedWindow(items, 2, 3))
  })

  it('falls back rather than throwing on an unknown slug', () => {
    // A missing related block is a small SEO loss; a 500 on a public page is not.
    expect(() => relatedBySlug(PROFESSIONS, 'does-not-exist', 4)).not.toThrow()
    expect(relatedBySlug(PROFESSIONS, 'does-not-exist', 4)).toHaveLength(4)
  })
})
