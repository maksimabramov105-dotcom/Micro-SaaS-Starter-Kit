/**
 * throughput_sim.ts — capacity simulation for the Playwright apply pipeline.
 *
 * Run:  npx tsx scripts/throughput_sim.ts
 *
 * Models daily apply capacity from the real runner knobs (no external services,
 * no DB needed) and checks it against the marketed tier promises for a sample
 * user mix. Proves the single-VPS pipeline can sustain the limits we sell.
 *
 * Capacity model (see lib/scheduling.ts + docs/SCALING.md):
 *   appliesPerRun   = floor(concurrency * runBudgetMs / avgApplyMs)
 *   dailyCapacity   = appliesPerRun * runsPerDay
 */
import { appliesPerRun, estimateDailyCapacity, isDeliverable, type CapacityModel } from '../lib/scheduling'

// Production knobs (keep in sync with run-campaigns + worker + docker-compose).
const RUN_BUDGET_MS = 1_200_000          // RUN_BUDGET_MS
const RUNS_PER_DAY = 48                   // cron */30
const WORKER_MEM_MB = 1500               // worker container limit
const PER_BROWSER_MB = 400               // ~chromium per apply (conservative)

// Two apply-latency scenarios: typical (observed ~10-20s) and worst-case timeout.
const SCENARIOS: { label: string; avgApplyMs: number }[] = [
  { label: 'typical (~20s/apply)', avgApplyMs: 20_000 },
  { label: 'conservative (45s/apply)', avgApplyMs: 45_000 },
  { label: 'worst-case (100s timeout)', avgApplyMs: 100_000 },
]

// A sample paying-user mix to test deliverability against.
const USER_MIX = [
  { tier: 'Pro', dailyLimit: 25, count: 10 },
  { tier: 'Unlimited', dailyLimit: 100, count: 3 }, // "unlimited" planned at 100/day
]
const demandPerDay = USER_MIX.reduce((s, u) => s + u.dailyLimit * u.count, 0)
const totalUsers = USER_MIX.reduce((s, u) => s + u.count, 0)

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

console.log('\nResumeAI throughput simulation')
console.log('='.repeat(72))
console.log(`Knobs: runBudget=${RUN_BUDGET_MS / 1000}s · runs/day=${RUNS_PER_DAY} · worker mem cap=${WORKER_MEM_MB}MB`)
console.log(`Demand: ${totalUsers} paying users → ${fmt(demandPerDay)} applies/day promised`)
console.log(`  ${USER_MIX.map((u) => `${u.count}×${u.tier}@${u.dailyLimit}`).join(' + ')}`)
console.log('-'.repeat(72))

let chosenConcurrency = 1
for (const concurrency of [1, 2, 3]) {
  const memNeeded = concurrency * PER_BROWSER_MB
  const memOk = memNeeded <= WORKER_MEM_MB - 300 // leave 300MB for python/base
  console.log(`\nconcurrency=${concurrency}  (≈${memNeeded}MB browsers, fits ${WORKER_MEM_MB}MB cap: ${memOk ? 'YES' : 'NO — would OOM'})`)
  for (const s of SCENARIOS) {
    const model: CapacityModel = { runsPerDay: RUNS_PER_DAY, concurrency, runBudgetMs: RUN_BUDGET_MS, avgApplyMs: s.avgApplyMs }
    const perRun = appliesPerRun(model)
    const cap = estimateDailyCapacity(model)
    const d = isDeliverable(demandPerDay, model)
    console.log(
      `  ${s.label.padEnd(28)} ${String(perRun).padStart(3)}/run  ${fmt(cap).padStart(7)}/day  ` +
        `vs ${fmt(demandPerDay)} demand → ${d.deliverable ? `OK (${d.ratio.toFixed(1)}x headroom)` : 'OVER CAPACITY'}`,
    )
  }
  if (memOk && concurrency === 2) chosenConcurrency = 2
}

// Verdict for the SHIPPED config (concurrency=2, conservative latency).
const shipped: CapacityModel = { runsPerDay: RUNS_PER_DAY, concurrency: chosenConcurrency, runBudgetMs: RUN_BUDGET_MS, avgApplyMs: 45_000 }
const verdict = isDeliverable(demandPerDay, shipped)
console.log('\n' + '='.repeat(72))
console.log(
  `SHIPPED: concurrency=${chosenConcurrency}, conservative 45s/apply → ` +
    `${fmt(estimateDailyCapacity(shipped))}/day capacity for ${fmt(demandPerDay)}/day demand: ` +
    `${verdict.deliverable ? `DELIVERABLE (${verdict.ratio.toFixed(1)}x headroom)` : 'NOT DELIVERABLE'}`,
)
console.log('='.repeat(72) + '\n')

if (!verdict.deliverable) process.exit(1)
