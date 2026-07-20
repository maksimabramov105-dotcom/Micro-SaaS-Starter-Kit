/**
 * Price + stats consistency guard (Prompt E1/E3).
 *
 * An external audit found prices contradicting each other across pages. This
 * test fails the build if OUR price values are hardcoded anywhere outside
 * lib/pricing.ts, so copy can never drift from the canonical source again.
 *
 * Adding a new price? Put it in lib/pricing.ts and import PRICE.* — do not
 * add it to the allowlist. The allowlist is only for figures that are NOT our
 * prices (competitor facts, legal thresholds, unit-cost math).
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'

import { PRICE, PRICING_PLANS, RESCUE_PRICE_USD, UPSELL_FIRST_MONTH_USD } from '@/lib/pricing'

const ROOT = path.resolve(__dirname, '../..')

/** Every price string that must never be hardcoded in a page/component. */
const OUR_PRICE_STRINGS = [
  PRICE.rescue, // $4.99
  PRICE.proMonthly, // $19
  PRICE.proYearly, // $180
  PRICE.proYearlyPerMo, // $15
  PRICE.upsellFirstMonth, // $9
]

/**
 * Justified exceptions — NOT our prices. Each entry is `file:reason`.
 * Competitor prices come from lib/seo-data.json (their pricing, not ours);
 * legal thresholds and unit-cost math are unrelated to plan pricing.
 */
const ALLOWLIST: { file: string; reason: string }[] = [
  { file: 'app/terms/page.tsx', reason: 'legal liability thresholds, not plan prices' },
  { file: 'app/dashboard/settings/automation/page.tsx', reason: 'per-application AI unit cost' },
  { file: 'app/dashboard/admin/page.tsx', reason: 'admin metric formatting ($0 placeholder)' },
  { file: 'app/admin/pmf/page.tsx', reason: 'admin dashboard money formatting helpers' },
  { file: 'app/api/webhooks/stripe/route.ts', reason: 'alert formatting from Stripe amounts' },
]

function sourceFiles(): string[] {
  const out = execSync(
    `git ls-files 'app/**/*.tsx' 'app/**/*.ts' 'components/**/*.tsx' 'components/**/*.ts'`,
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out.split('\n').filter(Boolean)
}

/** Strip comments so documentation mentioning a price isn't a violation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('canonical pricing', () => {
  it('lib/pricing.ts matches the live Stripe configuration (Pro $19/mo, $180/yr)', () => {
    const pro = PRICING_PLANS.find((p) => p.id === 'pro')!
    const proYearly = PRICING_PLANS.find((p) => p.id === 'pro_yearly')!
    expect(pro.price).toBe(19)
    expect(pro.intervalKey).toBe('month')
    expect(proYearly.price).toBe(180)
    expect(proYearly.intervalKey).toBe('year')
    // Annual is framed as "$15/mo billed annually"
    expect(PRICE.proYearlyPerMo).toBe('$15')
    expect(RESCUE_PRICE_USD).toBe(4.99)
    expect(UPSELL_FIRST_MONTH_USD).toBe(9)
  })

  it('the Unlimited tier is hidden everywhere (it does not exist on /pricing)', () => {
    const unlimited = PRICING_PLANS.filter((p) => p.id.startsWith('unlimited'))
    expect(unlimited.length).toBeGreaterThan(0)
    for (const plan of unlimited) {
      expect('hidden' in plan && plan.hidden).toBe(true)
    }
  })

  it('no page or component hardcodes one of our prices', () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file))
    const violations: string[] = []

    for (const file of sourceFiles()) {
      if (allowed.has(file)) continue
      const src = stripComments(readFileSync(path.join(ROOT, file), 'utf8'))
      for (const price of OUR_PRICE_STRINGS) {
        // Word-boundary-ish: "$19" must not match inside "$190".
        const re = new RegExp(`\\${price}(?![0-9])`)
        if (re.test(src)) {
          violations.push(`${file} hardcodes ${price} — import PRICE from lib/pricing.ts instead`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

describe('single stats source', () => {
  it('only lib/stats/verified.ts queries the verified-pipeline counters', () => {
    // /proof and the blog must not run their own counts — they diverged before
    // (homepage showed 321/88 while /proof showed 324/90).
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (!/^app\/(proof|blog)/.test(file)) continue
      const src = stripComments(readFileSync(path.join(ROOT, file), 'utf8'))
      if (/prisma\.(jobApplication|applicationEvent|inboxMessage)\./.test(src)) {
        offenders.push(`${file} queries pipeline counters directly — use lib/stats/verified.ts`)
      }
    }
    expect(offenders).toEqual([])
  })
})
