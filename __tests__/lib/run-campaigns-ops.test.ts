/**
 * Tests for the cron overlap-safety + recovery helpers (C2).
 */
import {
  tryAcquireLock,
  releaseLock,
  resetStaleQueued,
  saveRunSummary,
  getRunSummary,
  RUN_LOCK_KEY,
  type RunSummary,
} from '@/lib/run-campaigns-ops'

describe('tryAcquireLock', () => {
  it('acquires when SETNX returns OK (first fire)', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn() }
    const r = await tryAcquireLock(redis)
    expect(r).toEqual({ acquired: true, redisReachable: true })
    // SETNX semantics: NX + EX ttl
    expect(redis.set).toHaveBeenCalledWith(RUN_LOCK_KEY, expect.any(String), 'EX', expect.any(Number), 'NX')
  })

  it('does NOT acquire when the key is already held (second back-to-back fire)', async () => {
    const redis = { set: jest.fn().mockResolvedValue(null), del: jest.fn() }
    const r = await tryAcquireLock(redis)
    expect(r).toEqual({ acquired: false, redisReachable: true })
  })

  it('reports redisReachable=false on a Redis outage (caller fails open)', async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), del: jest.fn() }
    const r = await tryAcquireLock(redis)
    expect(r).toEqual({ acquired: false, redisReachable: false })
  })

  it('back-to-back fires: only the first acquires', async () => {
    let held = false
    const redis = {
      set: jest.fn(async () => (held ? null : ((held = true), 'OK'))),
      del: jest.fn(async () => { held = false }),
    }
    const first = await tryAcquireLock(redis)
    const second = await tryAcquireLock(redis)
    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(false) // ← never double-applies
    await releaseLock(redis)
    const third = await tryAcquireLock(redis)
    expect(third.acquired).toBe(true) // lock freed after release
  })
})

describe('resetStaleQueued (killed-run self-heal)', () => {
  it('deletes QUEUED rows older than the threshold and returns the count', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 })
    const db = { jobApplication: { deleteMany } }
    const n = await resetStaleQueued(db, 15 * 60 * 1000)
    expect(n).toBe(3)
    const arg = deleteMany.mock.calls[0][0]
    expect(arg.where.status).toBe('QUEUED')
    expect(arg.where.createdAt.lt).toBeInstanceOf(Date)
    // cutoff is ~15 min in the past
    expect(Date.now() - arg.where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000)
  })

  it('returns 0 when nothing is stale', async () => {
    const db = { jobApplication: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } }
    expect(await resetStaleQueued(db)).toBe(0)
  })
})

describe('run summary persistence', () => {
  it('round-trips a summary through the kv store', async () => {
    const store: Record<string, string> = {}
    const redis = {
      set: jest.fn(async (k: string, v: string) => { store[k] = v }),
      get: jest.fn(async (k: string) => store[k] ?? null),
    }
    const summary: RunSummary = {
      runAt: '2026-06-05T00:00:00Z', attempted: 5, submitted: 4, failed: 1,
      skipped: 20, staleQueuedReset: 2, finishedAt: '2026-06-05T00:05:00Z',
    }
    await saveRunSummary(redis, summary)
    expect(await getRunSummary(redis)).toEqual(summary)
  })

  it('returns null when no summary stored', async () => {
    const redis = { set: jest.fn(), get: jest.fn().mockResolvedValue(null) }
    expect(await getRunSummary(redis)).toBeNull()
  })
})
