/**
 * lib/scheduling.ts — fair-share scheduling + capacity model for the campaign
 * runner. Single-VPS, no queue broker: these are pure functions the runner and
 * the throughput simulation share.
 */

/**
 * Round-robin campaigns across users so each user gets a turn before any user
 * gets a second turn. Without this, the runner processes campaigns in fetch
 * order — so a user with many campaigns (or simply first in the list) can
 * consume the whole per-run time budget (RUN_BUDGET_MS) and starve everyone
 * else. Per-user order is preserved; users are cycled in first-seen order.
 */
export function interleaveByUser<T>(items: T[], getUserId: (item: T) => string): T[] {
  const queues = new Map<string, T[]>()
  const order: string[] = []
  for (const item of items) {
    const uid = getUserId(item)
    if (!queues.has(uid)) {
      queues.set(uid, [])
      order.push(uid)
    }
    queues.get(uid)!.push(item)
  }
  const out: T[] = []
  let remaining = items.length
  while (remaining > 0) {
    for (const uid of order) {
      const q = queues.get(uid)
      if (q && q.length > 0) {
        out.push(q.shift()!)
        remaining--
      }
    }
  }
  return out
}

export interface CapacityModel {
  /** Cron-triggered runs per day (e.g. every 30 min → 48). */
  runsPerDay: number
  /** Simultaneous Playwright applies per run (worker semaphore / web APPLY_CONCURRENCY). */
  concurrency: number
  /** Wall-clock budget per run, ms (RUN_BUDGET_MS). */
  runBudgetMs: number
  /** Average wall-clock time for one apply, ms. */
  avgApplyMs: number
}

/** Max applies one run can complete, given concurrency + budget + apply latency. */
export function appliesPerRun(m: CapacityModel): number {
  if (m.avgApplyMs <= 0) return 0
  return Math.floor((m.concurrency * m.runBudgetMs) / m.avgApplyMs)
}

/** Total daily apply capacity across ALL users (the shared ceiling). */
export function estimateDailyCapacity(m: CapacityModel): number {
  return appliesPerRun(m) * m.runsPerDay
}

/**
 * Is the marketed demand deliverable? `demand` = sum of active users' daily
 * application limits (what we promise). Returns whether capacity covers it,
 * plus the headroom ratio (capacity / demand).
 */
export function isDeliverable(demandPerDay: number, m: CapacityModel): { deliverable: boolean; capacity: number; ratio: number } {
  const capacity = estimateDailyCapacity(m)
  const ratio = demandPerDay > 0 ? capacity / demandPerDay : Infinity
  return { deliverable: capacity >= demandPerDay, capacity, ratio }
}
