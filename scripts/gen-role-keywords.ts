/**
 * gen-role-keywords.ts — role-coverage analysis for /resume-keywords (G2).
 *
 * Session B built lib/seo/role-keywords.json ad-hoc with no committed
 * generator, so the corpus could never be refreshed or audited. This script is
 * the auditable half: it buckets live listing titles into canonical roles and
 * reports which roles have enough REAL posting bodies to justify a page.
 *
 * ⚠️ READ BEFORE USING --write. The keyword extractor here is deterministic
 * (document frequency over description n-grams) and its output quality is NOT
 * publishable. Measured 2026-07-29 against the live corpus it produced company
 * names, US state names and benefits boilerplate ("PBC", "Veeva", "Nevada",
 * "Dental", "Days/8", "Let", "Thing") instead of ATS keywords. The 12 live role
 * pages were built with the LLM extractor (worker/worker/ai/keywords.py), which
 * understands semantics — that is the path any expansion must use.
 *
 * Root blocker for expansion: 363 of 475 cached listings (76%) have an EMPTY
 * `description`. The Greenhouse scrapers persist title + URL but not the body,
 * so most roles have no text to extract from at all. Fixing that is a crawler
 * data-capture change, and the apply engine is under the MASTER_PLAN freeze
 * rule — hence an owner decision, not a silent edit.
 *
 * So: use this to SEE coverage (default, read-only). Do not --write until the
 * keyword source is the LLM extractor.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/gen-role-keywords.ts
 *       npx tsx scripts/gen-role-keywords.ts --csv path/to/listings.csv
 *       (add --write to actually overwrite the JSON — see the warning above)
 */
import { writeFileSync, readFileSync } from 'fs'
import path from 'path'

const MIN_LISTINGS = 2
const MIN_KEYWORDS = 10
const MAX_KEYWORDS = 24
const OUT = path.resolve(__dirname, '../lib/seo/role-keywords.json')

interface Listing {
  title: string
  company: string
  description: string
}

/**
 * Canonical role buckets, matched in order against the listing title — first
 * match wins, so put the more specific patterns first (a "Senior Backend
 * Engineer" must not land in the generic "Software Engineer" bucket).
 */
const ROLE_PATTERNS: { slug: string; role: string; re: RegExp }[] = [
  // ── Engineering: specific disciplines first ────────────────────────────
  { slug: 'machine-learning-engineer', role: 'Machine Learning Engineer', re: /\b(machine learning|ml)\s+engineer\b/i },
  { slug: 'ai-engineer', role: 'AI Engineer', re: /\bai\s+(infrastructure\s+)?engineer\b|\bai\/ml\b/i },
  { slug: 'data-engineer', role: 'Data Engineer', re: /\bdata\s+engineer\b/i },
  { slug: 'analytics-engineer', role: 'Analytics Engineer', re: /\banalytics\s+engineer\b/i },
  { slug: 'data-scientist', role: 'Data Scientist', re: /\bdata\s+scientist\b/i },
  { slug: 'devops-engineer', role: 'DevOps Engineer', re: /\b(devops|sre|site reliability|platform)\s+engineer\b/i },
  { slug: 'infrastructure-engineer', role: 'Infrastructure Engineer', re: /\binfrastructure\s+engineer\b/i },
  { slug: 'security-engineer', role: 'Security Engineer', re: /\b(security|grc|appsec)\s+engineer\b/i },
  { slug: 'qa-engineer', role: 'QA Engineer', re: /\b(qa|quality assurance|test automation|sdet)\b.*\bengineer\b|\bqa\s+engineer\b/i },
  { slug: 'mobile-engineer', role: 'Mobile Engineer', re: /\b(ios|android|mobile|react native|flutter)\s+(engineer|developer)\b/i },
  { slug: 'frontend-engineer', role: 'Frontend Engineer', re: /\b(frontend|front-end|front end|ui)\s+(engineer|developer)\b/i },
  { slug: 'backend-engineer', role: 'Backend Engineer', re: /\b(backend|back-end|back end|python|golang|go|java|ruby|node)\s+(engineer|developer)\b/i },
  { slug: 'full-stack-engineer', role: 'Full Stack Engineer', re: /\bfull[\s-]?stack\s+(engineer|developer)\b/i },
  { slug: 'solutions-engineer', role: 'Solutions Engineer', re: /\b(solutions?|presales|pre-sales|sales)\s+engineer\b|\bsolutions? architect\b/i },
  { slug: 'forward-deployed-engineer', role: 'Forward Deployed Engineer', re: /\bforward[\s-]deployed\b/i },
  { slug: 'customer-success-engineer', role: 'Customer Success Engineer', re: /\bcustomer success engineer\b/i },
  { slug: 'support-engineer', role: 'Support Engineer', re: /\b(technical support|support|product support)\s+engineer\b/i },
  { slug: 'engineering-manager', role: 'Engineering Manager', re: /\bengineering manager\b|\bmanager,?\s+(engineering|software)\b/i },
  { slug: 'software-engineer', role: 'Software Engineer', re: /\b(software\s+)?engineer\b|\bdeveloper\b|\bprogrammer\b/i },

  // ── Support / success / ops ────────────────────────────────────────────
  { slug: 'technical-support-specialist', role: 'Technical Support Specialist', re: /\btechnical support (specialist|expert|consultant|technician)\b/i },
  { slug: 'customer-support-specialist', role: 'Customer Support Specialist', re: /\b(customer|client|product|consumer) support (specialist|consultant|advocate|agent|representative)\b/i },
  { slug: 'support-manager', role: 'Support Manager', re: /\b(manager,?\s+(technical\s+)?support|support manager)\b/i },
  { slug: 'it-support-specialist', role: 'IT Support Specialist', re: /\bit (support|systems)\b/i },
  { slug: 'customer-success-manager', role: 'Customer Success Manager', re: /\bcustomer success manager\b|\bcsm\b/i },
  { slug: 'operations-specialist', role: 'Operations Specialist', re: /\boperations (specialist|manager|analyst)\b|\bglobal operations\b/i },

  // ── Go-to-market ───────────────────────────────────────────────────────
  { slug: 'account-executive', role: 'Account Executive', re: /\baccount executive\b|\bae\b/i },
  { slug: 'sales-manager', role: 'Sales Manager', re: /\b(sales|revenue) (manager|director|lead)\b/i },
  { slug: 'marketing-manager', role: 'Marketing Manager', re: /\bmarketing (manager|lead|director|specialist)\b/i },

  // ── Product / design / people / finance ────────────────────────────────
  { slug: 'product-manager', role: 'Product Manager', re: /\bproduct manager\b|\bproduct owner\b/i },
  { slug: 'product-designer', role: 'Product Designer', re: /\b(product|ux|ui)\s+designer\b|\bux\/ui\b/i },
  { slug: 'hr-specialist', role: 'HR Specialist', re: /\b(hr|human resources|people|employee relations|benefits|lifecycle)\s+(specialist|partner|manager|coordinator)\b/i },
  { slug: 'recruiter', role: 'Recruiter', re: /\b(recruiter|talent acquisition|sourcer)\b/i },
  { slug: 'accountant', role: 'Accountant', re: /\b(accountant|accounting|payroll|expense)\b/i },
  { slug: 'data-analyst', role: 'Data Analyst', re: /\b(data|business|financial)\s+analyst\b/i },
  { slug: 'project-manager', role: 'Project Manager', re: /\b(project|program|delivery)\s+manager\b|\btpm\b/i },
]

/** Terms that are never useful ATS keywords. */
const STOP = new Set(
  `the a an and or but if then than that this these those with without within for from into onto of on in to at by as is are was were be been being will would can could should may might must have has had do does did not no nor so such very more most other others our your their its his her they we you i us them it he she who whom which what when where why how all any both each few many some own same too only just also about above below over under again further once here there all any both each more most other some such only own same than too very s t don now d ll m o re ve y ain aren couldn didn doesn hadn hasn haven isn ma mightn mustn needn shan shouldn wasn weren won wouldn work working works role roles job jobs team teams position candidate candidates you'll we're we'll experience years year required requirements responsibilities qualifications preferred plus bonus nice looking join help build ensure drive support manage lead across strong excellent ability able skills skill knowledge understanding company companies opportunity opportunities benefits salary remote hybrid onsite office full time part time please apply application applications employer equal diversity inclusive`
    .split(/\s+/)
    .filter(Boolean),
)

/** Tokens that mark a phrase as genuinely technical/ATS-relevant. */
const TECH = new RegExp(
  `\\b(python|javascript|typescript|java|golang|go|ruby|rust|c\\+\\+|c#|php|scala|kotlin|swift|sql|nosql|` +
    `react|vue|angular|svelte|next\\.?js|node\\.?js|django|flask|fastapi|rails|spring|laravel|` +
    `aws|azure|gcp|google cloud|kubernetes|k8s|docker|terraform|ansible|jenkins|github actions|gitlab ci|` +
    `postgres(?:ql)?|mysql|mongodb|redis|kafka|rabbitmq|elasticsearch|snowflake|databricks|dbt|airflow|spark|` +
    `graphql|rest api|grpc|microservices|distributed systems|ci/cd|devops|observability|prometheus|grafana|datadog|` +
    `machine learning|deep learning|pytorch|tensorflow|scikit|llm|nlp|computer vision|mlops|` +
    `salesforce|hubspot|zendesk|intercom|jira|confluence|figma|tableau|looker|power bi|segment|amplitude|` +
    `saas|b2b|b2c|api|sdk|oauth|saml|sso|soc 2|gdpr|hipaa|pci|iso 27001|` +
    `agile|scrum|kanban|linux|unix|bash|git|terraform|helm|serverless|lambda|etl|data warehouse|data pipeline)\\b`,
  'i',
)

function loadFromCsv(file: string): Listing[] {
  // Minimal RFC4180 parse: 3 columns, quoted fields may contain commas/newlines.
  const raw = readFileSync(file, 'utf8')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
    .filter((r) => r.length >= 3 && r[0])
    .map((r) => ({ title: r[0], company: r[1], description: r[2] }))
}

async function loadFromDb(): Promise<Listing[]> {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.jobListing.findMany({
      select: { title: true, company: true, description: true },
    })
    return rows.map((r) => ({ title: r.title, company: r.company, description: r.description ?? '' }))
  } finally {
    await prisma.$disconnect()
  }
}

function bucketOf(title: string): { slug: string; role: string } | null {
  for (const p of ROLE_PATTERNS) if (p.re.test(title)) return { slug: p.slug, role: p.role }
  return null
}

/** Candidate 1–3 word phrases from a description, lightly normalized. */
function candidates(text: string): Set<string> {
  const clean = text
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^A-Za-z0-9+#./\s-]/g, ' ')
  const words = clean.split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const gram = words.slice(i, i + n).join(' ')
      if (gram.length < 3 || gram.length > 40) continue
      const lower = gram.toLowerCase()
      if (lower.split(' ').some((w) => STOP.has(w))) continue
      if (!/[A-Za-z]/.test(gram)) continue
      // Keep it if it names a technology, or reads like a proper noun/term.
      const isTech = TECH.test(lower)
      const isProper = /^[A-Z]/.test(gram) && n <= 3
      if (isTech || isProper) out.add(isTech ? lower : gram)
    }
  }
  return out
}

function extractKeywords(listings: Listing[]): string[] {
  // Document frequency across the bucket's postings — recurring terms are the
  // ones an ATS for this role is actually weighting.
  //
  // DESCRIPTIONS ONLY, deliberately. Mining titles as a fallback was tried and
  // rejected: with 76% of cached listings holding an empty `description` (the
  // Greenhouse scrapers store URL + title but not the body), title mining
  // yielded company names, city names and sentence fragments ("Francisco",
  // "PBC", "Let", "Thing") rather than ATS keywords — worse than no page. A
  // role therefore only qualifies once we have real posting bodies for it.
  const df = new Map<string, number>()
  for (const l of listings) {
    for (const c of candidates(l.description)) df.set(c, (df.get(c) ?? 0) + 1)
  }
  const ranked = [...df.entries()]
    .filter(([, n]) => n >= Math.min(2, listings.length))
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([k]) => k)

  // Drop a phrase already covered by a shorter kept phrase (dedupe substrings).
  const kept: string[] = []
  for (const k of ranked) {
    const kl = k.toLowerCase()
    if (kept.some((s) => kl.includes(s.toLowerCase()) || s.toLowerCase().includes(kl))) continue
    kept.push(k)
    if (kept.length >= MAX_KEYWORDS) break
  }
  return kept
}

async function main() {
  const csvArg = process.argv.indexOf('--csv')
  // Read-only by DEFAULT: writing needs an explicit --write, because the
  // deterministic extractor's keyword quality is not publishable (see header).
  const dry = !process.argv.includes('--write')
  const listings = csvArg > -1 ? loadFromCsv(process.argv[csvArg + 1]) : await loadFromDb()
  console.log(`corpus: ${listings.length} listings`)

  const buckets = new Map<string, { role: string; items: Listing[] }>()
  let unmatched = 0
  for (const l of listings) {
    const b = bucketOf(l.title)
    if (!b) { unmatched++; continue }
    const cur = buckets.get(b.slug) ?? { role: b.role, items: [] }
    cur.items.push(l)
    buckets.set(b.slug, cur)
  }

  const out: {
    slug: string
    role: string
    keywords: string[]
    listingCount: number
    companies: string[]
  }[] = []
  const rejected: string[] = []

  for (const [slug, { role, items }] of [...buckets.entries()].sort((a, b) => b[1].items.length - a[1].items.length)) {
    const keywords = extractKeywords(items)
    const companies = [...new Set(items.map((i) => i.company).filter(Boolean))].sort()
    if (items.length < MIN_LISTINGS || keywords.length < MIN_KEYWORDS || companies.length === 0) {
      rejected.push(`${slug} (listings=${items.length}, keywords=${keywords.length})`)
      continue
    }
    out.push({ slug, role, keywords, listingCount: items.length, companies })
  }

  // MERGE, never replace: a role page that is already live and still has a
  // valid corpus record must not vanish because today's crawl happens to hold
  // fewer descriptions for it — de-indexing a ranking page is a real cost.
  // Fresh data wins per-slug; existing-only slugs are carried forward.
  let carried = 0
  try {
    const existing = JSON.parse(readFileSync(OUT, 'utf8')) as typeof out
    const freshSlugs = new Set(out.map((r) => r.slug))
    for (const prev of existing) {
      if (freshSlugs.has(prev.slug)) continue
      if (prev.keywords.length >= MIN_KEYWORDS && prev.listingCount >= 1) {
        out.push(prev)
        carried++
      }
    }
  } catch {
    /* first run — nothing to merge */
  }
  if (carried) console.log(`\ncarried forward ${carried} existing role page(s) with no fresh corpus match`)

  out.sort((a, b) => a.slug.localeCompare(b.slug))

  console.log(`\nPUBLISHED ${out.length} role pages:`)
  for (const r of out) console.log(`  ${r.slug.padEnd(30)} listings=${String(r.listingCount).padStart(3)} keywords=${r.keywords.length} companies=${r.companies.length}`)
  console.log(`\nREJECTED (too little corpus support) ${rejected.length}:`)
  for (const r of rejected) console.log(`  ${r}`)
  console.log(`\nunmatched titles: ${unmatched}`)

  const withBodies = listings.filter((l) => l.description.trim().length > 200).length
  console.log(
    `\nposting bodies available: ${withBodies}/${listings.length} ` +
      `(${Math.round((100 * withBodies) / Math.max(1, listings.length))}%) — keyword extraction can only ` +
      `use these; the rest are title+URL only`,
  )

  if (dry) {
    console.log('\nread-only (no --write). Keyword quality from this extractor is NOT publishable —')
    console.log('route any expansion through the LLM extractor in worker/worker/ai/keywords.py.')
    return
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`\nwrote ${OUT}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
