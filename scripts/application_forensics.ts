/**
 * application_forensics.ts — why did N submitted applications convert to 0 interviews?
 *
 * Run locally against prod:  DATABASE_URL=<prod> npx tsx scripts/application_forensics.ts
 * (The standalone prod image doesn't ship the TS source tree; run from a checkout
 *  with DATABASE_URL pointed at prod, or replicate via an inline @prisma/client call.)
 *
 * Reports, for every JobApplication:
 *   1. submitted before/after the contact-data fix (phone/intl-tel-input) → "dead" apps
 *   2. job geography vs the campaign profile's authorizedCountries (screening-knockout estimate)
 *   3. fit-score distribution
 *   4. submitted → reply → human → interview funnel
 *
 * Read-only. No fake data. Dates are configurable below.
 */
import { prisma } from '../lib/prisma'

// Contact-data fix (#50) deployed 2026-06-10 ~10:43 MSK (07:43 UTC). Apps before
// this went out with phone='' and missing LinkedIn/location → degraded contact.
const CONTACT_FIX = new Date('2026-06-10T07:43:00Z')

function regionSignal(s: string): string {
  s = (s || '').toLowerCase()
  if (/\bus only|u\.s\. only|united states only|authorized to work in the (us|united states)|us-based|usa only\b/.test(s)) return 'US-only'
  if (/\bremote\b/.test(s) && /\b(us|usa|united states)\b/.test(s)) return 'remote-US'
  if (/\b(anywhere|worldwide|global)\b/.test(s)) return 'global'
  if (/\bremote\b/.test(s)) return 'remote-unspecified'
  return 'onsite/other'
}

async function main() {
  const apps = await prisma.jobApplication.findMany({
    select: { status: true, location: true, jobTitle: true, fitScore: true, createdAt: true },
  })
  const submitted = apps.filter((a) => a.status === 'SUBMITTED')

  const byStatus: Record<string, number> = {}
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1

  const preFix = submitted.filter((a) => a.createdAt < CONTACT_FIX).length
  const geo: Record<string, number> = {}
  for (const a of submitted) {
    const k = regionSignal(`${a.location} ${a.jobTitle}`)
    geo[k] = (geo[k] ?? 0) + 1
  }
  const fits = submitted.map((a) => a.fitScore).filter((x): x is number => x != null)
  const avgFit = fits.length ? (fits.reduce((s, x) => s + x, 0) / fits.length).toFixed(1) : 'n/a'

  const inbox = await prisma.inboxMessage.groupBy({ by: ['classification'], _count: { _all: true } })
  const ic = (k: string) => inbox.find((g) => g.classification === k)?._count._all ?? 0

  console.log('\n=== APPLICATION FORENSICS ===')
  console.log('total apps:', apps.length, '| by status:', JSON.stringify(byStatus))
  console.log(`\nSUBMITTED: ${submitted.length}`)
  console.log(`  predate contact-fix (degraded contact, "dead"): ${preFix} (${Math.round((preFix / submitted.length) * 100)}%)`)
  console.log(`  eligible-for-conversion (post-fix): ${submitted.length - preFix}`)
  console.log('\ngeography (location+title signal):', JSON.stringify(geo))
  console.log(`fit-score: scored=${fits.length}/${submitted.length} avg=${avgFit}`)
  console.log('\nfunnel:')
  console.log(`  submitted              ${submitted.length}`)
  console.log(`  any inbound reply      ${ic('INTERVIEW_REQUEST') + ic('REJECTION') + ic('QUESTION') + ic('AUTOMATED')}`)
  console.log(`  human reply            ${ic('INTERVIEW_REQUEST') + ic('REJECTION') + ic('QUESTION')}`)
  console.log(`  interview request      ${ic('INTERVIEW_REQUEST')}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
