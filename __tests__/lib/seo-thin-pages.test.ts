/**
 * Thin / duplicate SEO-page guard (Prompt G4).
 *
 * Programmatic pages are only an asset if each one is substantial and distinct.
 * This test fails the build if any generated page (per-company application
 * guides, per-role keyword pages) would ship with:
 *   - fewer than MIN_WORDS words of editorial body content, or
 *   - a meta description that collides with another page's.
 *
 * The page and this guard read the SAME builders (applyToMeta/applyToBodyText,
 * roleMeta/roleBodyText), so copy can't drift out from under the check — the
 * E1 single-source-of-truth lesson applied to content, not just prices.
 *
 * Body word counts here EXCLUDE the live role/keyword lists the pages also
 * render, so they are a conservative floor: the real pages are longer.
 */
import {
  APPLY_COMPANIES,
  applyToMeta,
  applyToBodyText,
  ATS_GUIDE,
} from '@/lib/seo/apply-companies'
import { ROLE_KEYWORDS, roleMeta, roleBodyText } from '@/lib/seo/role-keywords'
import { PROFESSIONS, professionMeta, professionBodyText } from '@/lib/seo/professions'

const MIN_WORDS = 300

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

describe('SEO pages are substantial (>= 300 words)', () => {
  it.each(APPLY_COMPANIES.map((c) => [c.slug, c] as const))(
    '/apply-to/%s clears the thin-content floor',
    (_slug, c) => {
      // Every company must resolve to a real ATS guide.
      expect(ATS_GUIDE[c.ats]).toBeDefined()
      expect(wordCount(applyToBodyText(c))).toBeGreaterThanOrEqual(MIN_WORDS)
    },
  )

  it.each(ROLE_KEYWORDS.map((r) => [r.slug, r] as const))(
    '/resume-keywords/%s clears the thin-content floor',
    (_slug, r) => {
      // A role page with no corpus-backed keywords would be thin — forbid it.
      expect(r.keywords.length).toBeGreaterThanOrEqual(8)
      expect(r.listingCount).toBeGreaterThanOrEqual(1)
      expect(wordCount(roleBodyText(r))).toBeGreaterThanOrEqual(MIN_WORDS)
    },
  )

  // Added after these 20 pages were found live at ~235 words with no CTA at
  // all: they were the one template this guard never covered, which is exactly
  // how they stayed a scaffold while every other template moved on.
  it.each(PROFESSIONS.map((p) => [p.slug, p] as const))(
    '/resume/%s clears the thin-content floor',
    (_slug, p) => {
      expect(wordCount(professionBodyText(p))).toBeGreaterThanOrEqual(MIN_WORDS)
    },
  )
})

describe('SEO page titles and descriptions fit the seo_health gate', () => {
  // Same limits scripts/seo_health.ts enforces against the live site. Catching
  // an over-long title here beats catching it after deploy.
  it.each(PROFESSIONS.map((p) => [p.slug, p] as const))(
    '/resume/%s meta fits',
    (_slug, p) => {
      const m = professionMeta(p)
      expect(m.title.length).toBeLessThanOrEqual(65)
      expect(m.description.length).toBeLessThanOrEqual(155)
    },
  )
})

describe('no page repeats a claim the pivot retired', () => {
  // #197 removed "160+ companies" and the auto-apply-first framing everywhere,
  // but this template was missed and kept shipping both for weeks.
  const RETIRED = [/160\+/, /50\+ countries/i]

  it.each(PROFESSIONS.map((p) => [p.slug, p] as const))('/resume/%s is clean', (_slug, p) => {
    const text = professionBodyText(p)
    for (const claim of RETIRED) expect(text).not.toMatch(claim)
  })
})

describe('SEO meta descriptions are unique', () => {
  it('no two generated pages share a meta description', () => {
    const descriptions: { url: string; description: string }[] = [
      ...APPLY_COMPANIES.map((c) => ({
        url: `/apply-to/${c.slug}`,
        description: applyToMeta(c).description,
      })),
      ...ROLE_KEYWORDS.map((r) => ({
        url: `/resume-keywords/${r.slug}`,
        description: roleMeta(r).description,
      })),
    ]

    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const { url, description } of descriptions) {
      const key = description.trim().toLowerCase()
      const prior = seen.get(key)
      if (prior) collisions.push(`${url} duplicates ${prior}: "${description}"`)
      else seen.set(key, url)
    }

    expect(collisions).toEqual([])
  })

  it('every generated title and description respects the seo_health length gates', () => {
    const metas = [
      ...APPLY_COMPANIES.map((c) => applyToMeta(c)),
      ...ROLE_KEYWORDS.map((r) => roleMeta(r)),
    ]
    for (const m of metas) {
      expect(m.title.length).toBeLessThanOrEqual(65)
      expect(m.description.length).toBeLessThanOrEqual(155)
    }
  })
})
