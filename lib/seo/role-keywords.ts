/**
 * lib/seo/role-keywords.ts — typed access + single-source meta for the
 * /resume-keywords pages (G2/G4).
 *
 * The keyword corpus itself lives in role-keywords.json, regenerated from real
 * job descriptions our crawler indexed (see scripts/gen-role-keywords). The
 * page and the thin/duplicate guard both import the meta + body helpers here,
 * so descriptions can't drift into duplicates.
 */
import roleData from '@/lib/seo/role-keywords.json'

export interface RoleKeywords {
  slug: string
  role: string
  keywords: string[]
  listingCount: number
  companies: string[]
}

export const ROLE_KEYWORDS = roleData as RoleKeywords[]

export function getRole(slug: string): RoleKeywords | undefined {
  return ROLE_KEYWORDS.find((r) => r.slug === slug)
}

export function roleMeta(r: RoleKeywords): { title: string; description: string } {
  return {
    title: `Resume keywords for ${r.role} roles (2026)`,
    description: `ATS keywords for ${r.role} resumes, extracted from ${r.listingCount} real job postings — plus how to use them honestly so you pass screening.`,
  }
}

/** Intro paragraph — canonical copy rendered by the page. */
export function roleIntro(r: RoleKeywords): string {
  return (
    `These keywords were extracted by our keyword engine from ${r.listingCount} real ${r.role.toLowerCase()} ` +
    `job descriptions currently indexed by our crawler — postings from companies like ` +
    `${r.companies.slice(0, 4).join(', ')}. This is not a recycled listicle: it is what employers hiring ` +
    `for this role are asking for right now, and it refreshes as our crawler indexes new postings.`
  )
}

/** The two "how to use them" paragraphs — canonical copy rendered by the page. */
export const ROLE_HOWTO_PARAGRAPHS: readonly string[] = [
  'ATS screening is mostly presence-matching: the software checks whether the posting’s key terms appear in your resume at all. That makes two mistakes common. The first is omission — you have the skill but call it something else, and the filter never sees it. Fix that by mirroring the employer’s exact phrasing: if you write “CI pipelines” and the posting says “continuous integration”, use their words. The second mistake is stuffing — adding terms you cannot defend in an interview. That passes the software and fails the human, which is worse than failing early.',
  'Practically: put your strongest three keywords in the summary line, weave the rest into the bullets of your most recent two roles where they are truthfully applicable, and keep a skills section for the exact-match terms (tools, platforms, certifications). Then re-read the specific posting you are applying to — every job emphasizes a different subset, and tailoring to the actual posting beats any generic list, including this one.',
]

export function roleFaq(r: RoleKeywords): { q: string; a: string }[] {
  const role = r.role.toLowerCase()
  return [
    {
      q: `Where do these ${role} keywords come from?`,
      a: `Our keyword engine extracted them from ${r.listingCount} real ${role} job descriptions indexed by our crawler (companies like ${r.companies.slice(0, 3).join(', ')}). They are what employers actually ask for, not a generic list.`,
    },
    {
      q: 'Should I add every keyword to my resume?',
      a: 'No. Add only the ones that are truthfully applicable to your experience. ATS screening checks presence, but the human who reads you next checks credibility — stuffing keywords you cannot defend loses interviews.',
    },
    {
      q: 'Where in the resume should keywords go?',
      a: 'The summary and your most recent role carry the most weight: recruiters scan the top third of page one first, and most ATS relevance scoring weighs recent experience heaviest.',
    },
  ]
}

/** Full editorial text the role page renders — the guard asserts >=300 words. */
export function roleBodyText(r: RoleKeywords): string {
  return [
    roleIntro(r),
    r.keywords.join(' '),
    ...ROLE_HOWTO_PARAGRAPHS,
    ...roleFaq(r).flatMap((f) => [f.q, f.a]),
  ].join(' ')
}
