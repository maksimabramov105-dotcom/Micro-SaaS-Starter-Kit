/**
 * lib/run-campaigns-ops.ts
 *
 * Cron overlap-safety + recovery helpers for the campaign runner (C2).
 * Dependency-injected (redis/db passed in) so they unit-test without mocking
 * modules.
 *
 *  - tryAcquireLock / releaseLock — a Redis SETNX lock so a long run never
 *    overlaps the next cron fire (fail-open if Redis is down).
 *  - resetStaleQueued — a killed run leaves JobApplication rows stuck in QUEUED;
 *    the runner's dedup treats QUEUED as "never resend", so those rows would
 *    block the job forever. Deleting stale QUEUED rows auto-resets them to
 *    retryable. Safe because the lock guarantees no other run is mid-flight, and
 *    healthy QUEUED rows resolve to SUBMITTED/FAILED within ~100 s.
 *  - save/getRunSummary — last run's attempted/submitted/skipped/failed for the
 *    admin funnel view.
 */

export const RUN_LOCK_KEY = 'run-campaigns:lock'
export const RUN_LOCK_TTL_SEC = 1800 // auto-release if the process is killed mid-run
export const RUN_SUMMARY_KEY = 'run-campaigns:last-summary'
const STALE_QUEUED_MS = 15 * 60 * 1000 // older than this + still QUEUED ⇒ orphaned

export interface LockRedis {
  set(key: string, val: string, ex: 'EX', ttl: number, nx: 'NX'): Promise<string | null>
  del(key: string): Promise<unknown>
}
export interface KvRedis {
  set(key: string, val: string): Promise<unknown>
  get(key: string): Promise<string | null>
}
export interface QueuedDb {
  jobApplication: {
    deleteMany(args: { where: { status: 'QUEUED'; createdAt: { lt: Date } } }): Promise<{ count: number }>
  }
}

export interface RunSummary {
  runAt: string
  attempted: number
  submitted: number
  failed: number
  skipped: number
  staleQueuedReset: number
  finishedAt: string
}

/** SETNX lock. Returns acquired=false only when Redis is reachable AND the key
 *  is already held (a real concurrent run). On a Redis outage we report
 *  acquired=false + redisReachable=false so the caller can fail open. */
export async function tryAcquireLock(
  redis: LockRedis, key = RUN_LOCK_KEY, ttlSec = RUN_LOCK_TTL_SEC,
): Promise<{ acquired: boolean; redisReachable: boolean }> {
  try {
    const res = await redis.set(key, new Date().toISOString(), 'EX', ttlSec, 'NX')
    return { acquired: res === 'OK', redisReachable: true }
  } catch {
    return { acquired: false, redisReachable: false }
  }
}

export async function releaseLock(redis: LockRedis, key = RUN_LOCK_KEY): Promise<void> {
  try { await redis.del(key) } catch { /* TTL will expire it */ }
}

/** Delete QUEUED rows older than the threshold (orphans from a killed run), so
 *  the job becomes retryable. Returns how many were reset. */
export async function resetStaleQueued(db: QueuedDb, olderThanMs = STALE_QUEUED_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const { count } = await db.jobApplication.deleteMany({
    where: { status: 'QUEUED', createdAt: { lt: cutoff } },
  })
  return count
}

export async function saveRunSummary(redis: KvRedis, summary: RunSummary): Promise<void> {
  try { await redis.set(RUN_SUMMARY_KEY, JSON.stringify(summary)) } catch { /* best-effort */ }
}

export async function getRunSummary(redis: KvRedis): Promise<RunSummary | null> {
  try {
    const raw = await redis.get(RUN_SUMMARY_KEY)
    return raw ? (JSON.parse(raw) as RunSummary) : null
  } catch {
    return null
  }
}
