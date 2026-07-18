/**
 * lib/seo/apply-companies.ts — data + copy for /apply-to/{company} (B2).
 *
 * Companies come from the SAME curated lists the apply engine scrapes
 * (worker/worker/scrapers/*._COMPANIES exported to apply-companies.json), so
 * every page describes an ATS + company we genuinely operate against, and
 * the live open-roles count reuses the scraper cache (JobListing) that the
 * existing crons refresh — the pages stay current with zero manual work.
 */
import companiesJson from '@/lib/seo/apply-companies.json'

export interface ApplyCompany {
  slug: string
  name: string
  ats: 'greenhouse' | 'lever' | 'ashby' | 'recruitee' | 'personio'
  atsName: string
  boardUrl: string
}

export const APPLY_COMPANIES = companiesJson as ApplyCompany[]

export function getApplyCompany(slug: string): ApplyCompany | undefined {
  return APPLY_COMPANIES.find((c) => c.slug === slug)
}

/** Substring that identifies this company's postings in JobListing.url. */
export function jobUrlMatcher(c: ApplyCompany): string {
  switch (c.ats) {
    case 'greenhouse':
      return `greenhouse.io/${c.slug}`
    case 'lever':
      return `lever.co/${c.slug}`
    case 'ashby':
      return `ashbyhq.com/${c.slug}`
    case 'recruitee':
      return `${c.slug}.recruitee.com`
    case 'personio':
      return `${c.slug}.jobs.personio`
  }
}

/**
 * Per-ATS application walkthroughs — hand-written, honest, and genuinely
 * different per platform (this is the part applicants actually search for).
 */
export const ATS_GUIDE: Record<ApplyCompany['ats'], { form: string; tips: string[] }> = {
  greenhouse: {
    form:
      'Greenhouse applications are single-page forms: contact details, resume upload, ' +
      'and a set of company-chosen questions. The resume is parsed automatically, but ' +
      'parsed fields are NOT shown back to you on most boards — what the recruiter sees ' +
      'is your PDF plus your typed answers. Screening questions ("are you authorized to ' +
      'work in...", "will you require sponsorship") are usually hard knockouts that are ' +
      'filtered before a human reads anything, so answer them truthfully and exactly. ' +
      'Greenhouse also supports custom demographic sections that are optional and ' +
      'anonymized — skipping them does not affect your application.',
    tips: [
      'Greenhouse renders your resume PDF exactly as uploaded — a clean single-column layout survives their viewer best.',
      'Answer knockout questions (work authorization, sponsorship) exactly truthfully; they are machine-filtered before any human review.',
      'Repeat the top 3 skills from the job description in your resume summary — recruiters see the PDF, not parsed fields.',
    ],
  },
  lever: {
    form:
      'Lever postings use a compact one-page form: name, email, phone, resume, and ' +
      'optional links (LinkedIn, GitHub, portfolio). Lever parses your resume to ' +
      'pre-fill some fields, and unlike some ATSes it shows recruiters a structured ' +
      'candidate profile built from that parse — so parseability matters more here. ' +
      'Cover letters are usually a single "additional information" box rather than an ' +
      'upload. Lever tracks the posting source, so applying directly on the company\'s ' +
      'jobs.lever.co board (rather than an aggregator re-post) attributes your ' +
      'application cleanly and avoids stale re-posts.',
    tips: [
      'Lever builds a structured profile from your resume parse — use standard section headings ("Experience", "Education", "Skills") so nothing is lost.',
      'Fill the links fields: Lever displays LinkedIn/GitHub prominently on the recruiter view.',
      'Apply on the company\'s own jobs.lever.co board, not an aggregator copy — re-posts go stale and misattribute.',
    ],
  },
  ashby: {
    form:
      'Ashby is the newest of the major ATSes and its application forms are fast, ' +
      'single-page, and often minimal: resume plus a handful of targeted questions. ' +
      'Ashby-native companies tend to review quickly and use structured scorecards, ' +
      'so the specific claims in your resume (metrics, technologies, scope) matter ' +
      'more than formatting flourishes. Many Ashby boards also show salary ranges and ' +
      'detailed role descriptions — read them fully: the screening questions usually ' +
      'map one-to-one to the "requirements" list in the posting.',
    tips: [
      'Ashby screening questions typically mirror the requirements list — mirror its exact wording where truthful.',
      'Include concrete metrics (team size, latency, revenue) — Ashby-native teams review against structured scorecards.',
      'Keep answers tight; Ashby recruiters see questions and resume side-by-side.',
    ],
  },
  recruitee: {
    form:
      'Recruitee boards ({company}.recruitee.com) are common at European scale-ups. ' +
      'The form is single-page with resume upload and free-text fields, and often a ' +
      'GDPR consent checkbox — you must tick it or the application is not stored. ' +
      'Recruitee supports multi-language postings; apply in the language of the ' +
      'posting itself. Resume parsing is lighter than Greenhouse/Lever, so the PDF ' +
      'you upload is essentially what gets reviewed — layout and readability carry ' +
      'the weight.',
    tips: [
      'Apply in the language the posting is written in — mixed-language applications read as spray-and-pray.',
      'The GDPR consent box is mandatory; without it your application is silently dropped.',
      'Your PDF is reviewed as-is (light parsing) — invest in a clean, readable layout.',
    ],
  },
  personio: {
    form:
      'Personio is widespread among German and Austrian companies. Application forms ' +
      'are hosted on {company}.jobs.personio.de, usually asking for resume, optional ' +
      'cover letter, and earliest start date plus salary expectation — two fields ' +
      'many applicants leave empty, which recruiters read as carelessness. German ' +
      'companies commonly still expect a short cover note. Documents are reviewed ' +
      'as uploaded (minimal parsing), and applications feed straight into the ' +
      'company\'s internal Personio pipeline with GDPR-compliant retention.',
    tips: [
      'Fill "earliest start date" and "salary expectation" honestly — empty fields read as carelessness to German recruiters.',
      'Add a short cover note; DACH hiring culture still expects one.',
      'State your work-authorization status for Germany/EU explicitly in the resume header — it is the first thing checked.',
    ],
  },
}
