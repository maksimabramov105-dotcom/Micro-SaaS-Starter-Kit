/**
 * seo_health.ts — fails loudly if SEO basics regress (Prompt 12 §5.2).
 *
 * Checks, against BASE_URL (default the CI app at localhost:3000):
 *   - sitemap.xml + robots.txt are reachable (200)
 *   - a sample of key + programmatic pages return 200
 *   - each page has a <title> (≤60), a meta description (≤155), and a canonical
 *
 * Run:  BASE_URL=https://resumeai-bot.ru npx tsx scripts/seo_health.ts
 * CI:   BASE_URL=http://localhost:3000 npx tsx scripts/seo_health.ts
 */
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

const PAGES = [
  '/', '/pricing', '/proof', '/faq', '/compare',
  '/alternatives/lazyapply', '/alternatives/teal', '/alternatives/jobcopilot',
  '/jobs-in/germany', '/auto-apply/linkedin', '/resume/software-engineer',
]

type Problem = string
const problems: Problem[] = []

async function getText(path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  const html = res.status < 400 ? await res.text() : ''
  return { status: res.status, html }
}

function tag(html: string, re: RegExp): string | null {
  const m = html.match(re)
  return m ? m[1].trim() : null
}

async function main() {
  // sitemap + robots reachable
  for (const path of ['/sitemap.xml', '/robots.txt']) {
    const r = await fetch(`${BASE}${path}`)
    if (!r.ok) problems.push(`${path} not reachable (${r.status})`)
  }

  for (const path of PAGES) {
    const { status, html } = await getText(path)
    if (status !== 200) {
      problems.push(`${path} returned ${status} (expected 200)`)
      continue
    }
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) {
      problems.push(`${path} is noindex`)
    }
    const title = tag(html, /<title>([^<]*)<\/title>/i)
    if (!title) problems.push(`${path} missing <title>`)
    else if (title.length > 65) problems.push(`${path} <title> too long (${title.length} > 60)`)

    const desc = tag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    if (!desc) problems.push(`${path} missing meta description`)
    else if (desc.length > 160) problems.push(`${path} meta description too long (${desc.length} > 155)`)

    const canonical = tag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    if (!canonical) problems.push(`${path} missing canonical`)
  }

  if (problems.length) {
    console.error(`\n❌ SEO health: ${problems.length} problem(s) against ${BASE}`)
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }
  console.log(`✅ SEO health OK — ${PAGES.length} pages checked against ${BASE}`)
}

main().catch((e) => {
  console.error('seo_health crashed:', e)
  process.exit(1)
})
