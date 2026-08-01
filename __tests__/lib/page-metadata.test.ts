/**
 * Static-page metadata guard.
 *
 * Found by crawling production for the launch audit: /terms, /privacy,
 * /refund-policy, /contact and /changelog were all reachable, indexable, and
 * shipping with NO canonical link. Nothing in CI looked at hand-written pages —
 * seo_health checks title and description lengths on the live site, and the
 * thin-content guard only covers the generated templates — so a page could be
 * added with no canonical and nothing would say so.
 *
 * These read the source rather than rendering, deliberately: the failure is a
 * missing export, and a source assertion catches it in the file where the fix
 * belongs.
 */
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

/** Hand-written public pages. Generated templates have their own guard. */
const PUBLIC_PAGES = [
  'terms',
  'privacy',
  'refund-policy',
  'contact',
  'changelog',
  'pricing',
  'proof',
]

function source(slug: string): string {
  const p = path.join(ROOT, 'app', slug, 'page.tsx')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/**
 * Source with comments removed. Needed because the changelog's own header
 * quotes the template copy it replaced, and a naive search finds that quote.
 */
function code(slug: string): string {
  return source(slug)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('every public page declares a canonical', () => {
  it.each(PUBLIC_PAGES)('/%s', (slug) => {
    const s = source(slug)
    expect(s).not.toBe('')
    // Either an explicit alternates.canonical, or metadata built by a helper
    // that supplies one.
    expect(s).toMatch(/alternates:\s*\{[^}]*canonical/)
  })

  it.each(PUBLIC_PAGES)('/%s canonical is not a hardcoded host', (slug) => {
    // The property that matters: the host comes from config, not from a string
    // literal. Hardcoding is how 35 files ended up pinned to the old domain and
    // kept serving .ru canonicals after the migration.
    expect(code(slug)).not.toMatch(/canonical:\s*['"`]\s*https?:\/\//)
  })
})

describe('the changelog states real history', () => {
  const s = code('changelog')

  it('does not carry the starter-kit template entries', () => {
    // Shipped live for months: "v1.0.0 — January 2024 — Initial release with
    // full authentication system / API key management system". The product did
    // not exist then and those were never its features.
    expect(s).not.toMatch(/January 2024/)
    expect(s).not.toMatch(/Initial release with full authentication system/)
    expect(s).not.toMatch(/API key management system/)
  })

  it('dates every entry', () => {
    const dates = s.match(/date: '[^']+'/g) ?? []
    expect(dates.length).toBeGreaterThan(0)
    // A changelog without years is not a changelog.
    for (const d of dates) expect(d).toMatch(/20\d\d/)
  })
})
