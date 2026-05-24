/**
 * scripts/experiment_results.ts
 *
 * Prints per-variant assignment counts, conversion rates, and a two-proportion
 * Z-test p-value so you can decide if an experiment has a statistically
 * significant winner.
 *
 * Usage:
 *   npx tsx scripts/experiment_results.ts <experiment_key> [conversion_event]
 *
 * Examples:
 *   npx tsx scripts/experiment_results.ts pricing_headline_v1
 *   npx tsx scripts/experiment_results.ts pricing_headline_v1 checkout_started
 *   npx tsx scripts/experiment_results.ts pro_price_v1 checkout_started
 *
 * Defaults:
 *   conversion_event = 'checkout_started'
 *
 * Interpretation:
 *   p < 0.05 → 95% confidence the difference is real (ship the winner)
 *   p < 0.10 → 90% confidence (keep running for another week)
 *   p ≥ 0.10 → not significant (need more data)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── Two-proportion Z-test ────────────────────────────────────────────────────
// Returns p-value (two-tailed).
function zTestTwoProportions(
  n1: number, x1: number,   // group 1: total, conversions
  n2: number, x2: number,   // group 2: total, conversions
): number {
  if (n1 === 0 || n2 === 0) return 1
  const p1 = x1 / n1
  const p2 = x2 / n2
  const pPool = (x1 + x2) / (n1 + n2)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2))
  if (se === 0) return 1
  const z = Math.abs((p1 - p2) / se)
  // Approximate p-value from Z using complementary error function
  return 2 * (1 - normalCDF(z))
}

// Abramowitz & Stegun approximation (accurate to ±7.5×10⁻⁸)
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))))
  const phi = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly
  return z >= 0 ? phi : 1 - phi
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const experimentKey = process.argv[2]
  const conversionEvent = process.argv[3] ?? 'checkout_started'

  if (!experimentKey) {
    console.error('Usage: npx tsx scripts/experiment_results.ts <experiment_key> [conversion_event]')
    process.exit(1)
  }

  const exp = await prisma.experiment.findUnique({ where: { key: experimentKey } })
  if (!exp) {
    console.error(`Experiment "${experimentKey}" not found.`)
    process.exit(1)
  }

  console.log(`\n═══ Experiment: ${exp.key} ═══`)
  console.log(`Description : ${exp.description ?? '—'}`)
  console.log(`Status      : ${exp.active ? 'ACTIVE' : 'ENDED'}`)
  console.log(`Started     : ${exp.startedAt.toISOString().slice(0, 10)}`)
  if (exp.endedAt) console.log(`Ended       : ${exp.endedAt.toISOString().slice(0, 10)}`)
  console.log(`Conversion  : ${conversionEvent}\n`)

  // ── Assignments per variant ──────────────────────────────────────────────
  const assignmentCounts = await prisma.experimentAssignment.groupBy({
    by: ['variant'],
    where: { experimentKey },
    _count: { variant: true },
  })
  const totalAssignments = assignmentCounts.reduce((s, r) => s + r._count.variant, 0)

  const variantData: Record<string, { n: number; conversions: number }> = {}
  for (const r of assignmentCounts) {
    variantData[r.variant] = { n: r._count.variant, conversions: 0 }
  }

  // ── Conversions: AnalyticsEvent rows where properties->>'experiment_key' matches ──
  // We look for analytics events where the user/anonId was assigned to this experiment.
  const assignments = await prisma.experimentAssignment.findMany({
    where: { experimentKey },
    select: { variant: true, userId: true, anonId: true },
  })

  // Build a map: userId/anonId → variant
  const userVariant = new Map<string, string>()
  const anonVariant = new Map<string, string>()
  for (const a of assignments) {
    if (a.userId) userVariant.set(a.userId, a.variant)
    if (a.anonId) anonVariant.set(a.anonId, a.variant)
  }

  // Count conversion events for each variant
  // Convention: events have properties.experiment_key = experimentKey AND properties.variant = variant
  const conversionEvents = await prisma.analyticsEvent.findMany({
    where: {
      event: conversionEvent,
    },
    select: { userId: true, properties: true },
  })

  for (const e of conversionEvents) {
    const props = e.properties as Record<string, unknown> | null
    // Prefer explicit experiment_key/variant tagging in properties
    if (props?.experiment_key === experimentKey && typeof props?.variant === 'string') {
      const v = props.variant as string
      if (variantData[v]) variantData[v].conversions++
      continue
    }
    // Fallback: look up variant by userId
    if (e.userId) {
      const v = userVariant.get(e.userId)
      if (v && variantData[v]) variantData[v].conversions++
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('┌────────────────────┬──────────┬─────────────┬──────────────┐')
  console.log('│ Variant            │ Assigned │ Conversions │ Conv. Rate   │')
  console.log('├────────────────────┼──────────┼─────────────┼──────────────┤')

  const variantRows = exp.variants.map((v: string) => {
    const d = variantData[v] ?? { n: 0, conversions: 0 }
    const rate = d.n > 0 ? (d.conversions / d.n) * 100 : 0
    return { variant: v, ...d, rate }
  })

  for (const row of variantRows) {
    const v = row.variant.padEnd(18)
    const n = String(row.n).padStart(8)
    const c = String(row.conversions).padStart(11)
    const r = `${row.rate.toFixed(2)}%`.padStart(12)
    console.log(`│ ${v} │ ${n} │ ${c} │ ${r} │`)
  }

  console.log('├────────────────────┼──────────┼─────────────┼──────────────┤')
  console.log(`│ TOTAL              │ ${String(totalAssignments).padStart(8)} │             │              │`)
  console.log('└────────────────────┴──────────┴─────────────┴──────────────┘')

  // ── Statistical significance (only for 2-variant experiments) ────────────
  if (variantRows.length === 2) {
    const [a, b] = variantRows
    const pVal = zTestTwoProportions(a.n, a.conversions, b.n, b.conversions)
    const sig95 = pVal < 0.05 ? '✅ YES (p < 0.05)' : '❌ NO'
    const sig90 = pVal < 0.10 ? '✅ YES (p < 0.10)' : '❌ NO'
    const lift = a.rate > 0 ? ((b.rate - a.rate) / a.rate) * 100 : 0

    console.log(`\n── Statistical Test (Z-test, two-tailed) ──`)
    console.log(`p-value         : ${pVal.toFixed(4)}`)
    console.log(`95% confidence  : ${sig95}`)
    console.log(`90% confidence  : ${sig90}`)
    console.log(`Lift (${b.variant} vs ${a.variant}): ${lift >= 0 ? '+' : ''}${lift.toFixed(1)}%`)

    if (pVal < 0.05) {
      const winner = b.rate > a.rate ? b.variant : a.variant
      console.log(`\n🏆 WINNER: ${winner} — safe to ship.`)
    } else if (pVal < 0.10) {
      console.log('\n⏳ Run for another week, then re-analyze.')
    } else {
      console.log('\n📊 Not significant yet — need more traffic.')
    }
  }

  console.log('')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
