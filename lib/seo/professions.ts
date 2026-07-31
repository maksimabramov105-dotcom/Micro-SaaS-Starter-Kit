/**
 * lib/seo/professions.ts — copy builders for /resume/{profession}.
 *
 * WHY THIS FILE EXISTS: the 20 profession pages were the oldest programmatic
 * template and the only one still shipping as a scaffold — no site navigation,
 * no CTA of any kind, ~235 words of body copy, and pre-pivot claims ("auto-apply
 * to matching remote-first roles at 160+ companies") that #197 removed from
 * every other surface. They were also the one template the thin-content guard
 * never covered, which is exactly how they stayed that way.
 *
 * The builders live here rather than in the page so the guard can assert against
 * the SAME copy the page renders — the single-source-of-truth lesson this
 * codebase already learned about prices, applied to content.
 *
 * The substance comes from real data. Where a profession matches a role in the
 * keyword corpus, the page reports keywords extracted from actual indexed job
 * postings and says how many. Where it does not, the page says what it does know
 * and does not pad: a page that admits a narrower scope beats a page that
 * invents an authoritative-sounding paragraph.
 */
import seo from '@/lib/seo-data.json'
import { getRole, type RoleKeywords } from '@/lib/seo/role-keywords'

export interface Profession {
  slug: string
  name: string
  keywords: string[]
  note: string
}

export const PROFESSIONS = seo.professions as Profession[]

export function getProfession(slug: string): Profession | undefined {
  return PROFESSIONS.find((p) => p.slug === slug)
}

/**
 * The keyword-corpus entry for this profession, when one exists.
 *
 * Slugs mostly line up (`data-analyst`, `devops-engineer`); a few need an
 * explicit bridge because the two datasets were built at different times.
 */
const ROLE_SLUG_OVERRIDES: Record<string, string> = {
  'customer-support': 'customer-support-specialist',
}

export function corpusRole(p: Profession): RoleKeywords | undefined {
  return getRole(ROLE_SLUG_OVERRIDES[p.slug] ?? p.slug)
}

export function professionMeta(p: Profession): { title: string; description: string } {
  return {
    // seo_health gate: title <= 65, description <= 155.
    title: `${p.name} resume: what passes ATS screening`,
    description: `Write a ${p.name} resume that clears ATS filters: the keywords that matter, what to cut, and a free fit check against a real posting.`,
  }
}

/**
 * Body copy, as plain text, in render order. The page renders these as real
 * elements; the guard counts their words.
 */
export function professionBody(p: Profession): string[] {
  const role = corpusRole(p)
  const paras: string[] = [
    `Most ${p.name} applications are rejected before a person reads them. Not because the ` +
      `candidate is unqualified, but because the resume does not use the words the posting ` +
      `uses, so the filter never scores it properly. ${p.note}`,

    `That is a fixable problem, and it is worth being precise about what "fixable" means. ` +
      `Tailoring a resume does not mean claiming skills you do not have. It means describing ` +
      `the experience you already have in the language a specific employer is scanning for — ` +
      `matching their exact wording for tools you genuinely use, putting the relevant work ` +
      `first, and cutting the parts that do not speak to this role.`,
  ]

  if (role) {
    paras.push(
      `For ${p.name} roles specifically, our keyword engine reads real job descriptions as ` +
        `they are indexed. Across ${role.listingCount} ${role.role.toLowerCase()} postings it ` +
        `most often found: ${role.keywords.slice(0, 12).join(', ')}. These are not guesses ` +
        `about what employers might want — they are the terms that actually recur in postings ` +
        `for this role.`,
      `Use that list as a checklist against your own resume, not as a script. If a term is ` +
        `there and you have done the work, make sure the resume says so in those words. If a ` +
        `term is there and you have not, that gap is useful information: it tells you what to ` +
        `learn next, or that you are aiming at a level you have not reached yet.`,
    )
  } else {
    paras.push(
      `For a ${p.name}, the terms that carry the most weight through screening are usually ` +
        `${p.keywords.join(', ')}. Our keyword corpus does not yet cover this role in depth — ` +
        `it is built from the technology and operations postings our crawler indexes — so ` +
        `treat that as a starting point and read three or four real postings for the specific ` +
        `jobs you want, then mirror their vocabulary.`,
    )
  }

  paras.push(
    `Two structural things matter as much as vocabulary. Keep the layout ATS-safe: a single ` +
      `column, standard headings, no tables or text boxes or images that parsers mangle into ` +
      `nonsense. And make your eligibility explicit at the top — work authorisation and ` +
      `location decide more outcomes than most candidates realise, and a filter that cannot ` +
      `tell will usually assume the answer it likes least.`,

    `The fastest way to find out where you stand is to check one real posting rather than ` +
      `guessing. Paste a ${p.name} job you actually want into the free fit check and you get a ` +
      `score, the keywords that posting wants which your resume is missing, and what to change ` +
      `first. It takes about two minutes, needs no account, and there is no limit on it.`,

    `If you would rather have the rewrite done for you, that is what the paid option is: your ` +
      `resume rewritten for one specific posting, plus a report showing exactly what was ` +
      `getting you filtered out. Either way you are working from what a real posting asks for, ` +
      `not from a template.`,
  )

  return paras
}

export function professionFaq(p: Profession): { q: string; a: string }[] {
  const role = corpusRole(p)
  return [
    {
      q: `What should a ${p.name} resume include?`,
      a:
        `${p.note} Beyond that, mirror the posting's own wording for the tools and ` +
        `responsibilities you genuinely have, keep it to a single column with standard ` +
        `headings so the parser reads it correctly, and state your work authorisation and ` +
        `location where a screener will see them immediately.`,
    },
    {
      q: `Which keywords matter most for ${p.name} roles?`,
      a: role
        ? `Extracted from ${role.listingCount} real ${role.role.toLowerCase()} postings, the ` +
          `most frequent are ${role.keywords.slice(0, 8).join(', ')}. Only use the ones that ` +
          `are true of you — a keyword you cannot discuss in an interview costs you more than ` +
          `the screen it passed.`
        : `Commonly ${p.keywords.join(', ')} — but the reliable method is to read three or ` +
          `four postings for the exact jobs you want and mirror their vocabulary, since ` +
          `wording varies more by employer than by role.`,
    },
    {
      q: `Can AI write my ${p.name} resume?`,
      a:
        `It can rewrite yours for a specific posting, which is the part that actually moves ` +
        `the needle. What it should not do is invent experience. Everything here works from ` +
        `the resume you already have and the posting you are targeting.`,
    },
    {
      q: `How do I know if my resume is good enough before I apply?`,
      a:
        `Run it against the posting. The free fit check scores your resume against one real ` +
        `job, lists the keywords that job wants which you are missing, and names the single ` +
        `biggest thing to change. No account needed.`,
    },
  ]
}

/** Everything the guard counts: body paragraphs plus FAQ answers. */
export function professionBodyText(p: Profession): string {
  return [...professionBody(p), ...professionFaq(p).flatMap((f) => [f.q, f.a])].join(' ')
}
