/**
 * scripts/lighthouse_check.ts — Lighthouse budget gate.
 *
 * The launch audit ran Lighthouse by hand and found everything green, but a
 * one-off number is not a guard: /pricing had already silently fallen to 72
 * once, when server-side A/B assignment opted it out of static rendering. It
 * only came back because someone happened to measure it.
 *
 * Thresholds are deliberately just under the measured values, so this catches a
 * real regression without failing on the couple of points Lighthouse moves run
 * to run.
 *
 * RUN THIS ON A QUIET MACHINE. Lighthouse throttles CPU on the machine running
 * it, not on the server, so anything else competing for cores shows up as a
 * performance dip on whichever page happens to be measured then. On a busy
 * laptop the dip simply follows the first page audited — observed here: /pricing
 * read 99, 82, 71, 72, then 80 while / dropped to 73, all against the same
 * unchanged deploy. Measured in isolation every page is 96-100 with a 120 ms
 * server response.
 *
 * That is why this is NOT wired into CI as a blocking gate. A check that fails
 * at random gets ignored, and an ignored check is worse than none. Run it
 * deliberately, on a quiet box, when you have changed something that could
 * affect page weight or rendering mode.
 *
 * Usage:  npx tsx scripts/lighthouse_check.ts [baseUrl]
 * Needs Chrome; set CHROME_PATH if it is not on the default path.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'https://resumeai-bot.com'

/**
 * The launch bar: accessibility, best-practices and SEO at 90+, performance at
 * 80+.
 *
 * Performance is the loose one on purpose. Measured back-to-back on the same
 * unchanged deploy, /pricing scored 99 and then 82 — this box is a shared 2-vCPU
 * VPS and Lighthouse's throttling amplifies whatever else it happens to be
 * doing. A 90 budget would fail on noise, and a gate that cries wolf gets
 * ignored, which is worse than no gate. 80 still catches the failure that
 * actually happened here: /pricing fell to 72 when server-side A/B assignment
 * opted it out of static rendering.
 */
const BUDGETS: Record<string, Record<string, number>> = {
  '/': { performance: 80, accessibility: 90, 'best-practices': 90, seo: 100 },
  '/ats-check': { performance: 80, accessibility: 90, 'best-practices': 90, seo: 100 },
  '/resume-rescue': { performance: 80, accessibility: 90, 'best-practices': 90, seo: 100 },
  '/pricing': { performance: 80, accessibility: 90, 'best-practices': 90, seo: 100 },
}

function audit(url: string, out: string): Record<string, number> {
  execFileSync(
    'npx',
    [
      '--yes', 'lighthouse@12', url,
      '--output=json', `--output-path=${out}`, '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
      '--only-categories=performance,accessibility,best-practices,seo',
    ],
    { stdio: 'ignore', timeout: 180_000 },
  )
  const report = JSON.parse(readFileSync(out, 'utf8')) as {
    categories: Record<string, { score: number | null }>
  }
  return Object.fromEntries(
    Object.entries(report.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
  )
}

/**
 * Best of two runs, with a pause between them.
 *
 * The pause is the important part. Lighthouse throttles CPU on the MACHINE
 * RUNNING IT, not on the server, so audits fired back-to-back starve each
 * other: /pricing measured 99, 82, 71 and then 72 twice while the same page
 * audited in isolation scored 99 with a 120 ms server response and no
 * opportunities over 150 ms. The page was never slow; the harness was.
 *
 * Best-of-two plus a settle gap absorbs that, and still catches a real
 * regression — which fails both runs. The failure this guard exists for
 * (/pricing stuck at 72 after server-side A/B assignment opted it out of static
 * rendering) was persistent, not occasional.
 */
function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function bestOfTwo(url: string, a: string, b: string): Record<string, number> {
  const first = audit(url, a)
  sleep(5000)
  const second = audit(url, b)
  const out: Record<string, number> = {}
  for (const k of new Set([...Object.keys(first), ...Object.keys(second)])) {
    out[k] = Math.max(first[k] ?? 0, second[k] ?? 0)
  }
  return out
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'lh-'))
  const failures: string[] = []
  try {
    for (const [path, budget] of Object.entries(BUDGETS)) {
      const slug = path.replace(/\W/g, '_')
      const scores = bestOfTwo(`${BASE}${path}`, join(dir, `${slug}-a.json`), join(dir, `${slug}-b.json`))
      const line = Object.entries(scores)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      console.log(`${path.padEnd(16)} ${line}`)
      for (const [cat, min] of Object.entries(budget)) {
        const got = scores[cat] ?? 0
        if (got < min) failures.push(`${path} ${cat}: ${got} < ${min}`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (failures.length) {
    console.error('\nLighthouse budget FAILED:')
    for (const f of failures) console.error('  ' + f)
    process.exit(1)
  }
  console.log('\nAll pages within budget.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
