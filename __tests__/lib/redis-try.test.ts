/**
 * @jest-environment node
 *
 * redisTry — a deadline on request-path Redis calls.
 *
 * Found by stopping Redis in production during the launch audit:
 *
 *   POST /api/ats-check  →  http=000 after 45s
 *
 * The endpoint hung until the client gave up. Every rate limiter wrapped its
 * Redis call in try/catch expecting to fail open, but the catch could never
 * fire: the client is built with `maxRetriesPerRequest: null`, which makes
 * ioredis QUEUE commands indefinitely while disconnected rather than rejecting
 * them. The promise simply never settles.
 *
 * Compare the worker outage in the same audit, which correctly returned a
 * friendly 503 in 5.4 seconds. The difference is a deadline.
 */
import { redisTry } from '@/lib/redis'

// No mocking: redisTry takes the command as a callback, so the behaviour that
// matters — what happens when that command hangs or throws — is testable
// directly. getRedis() itself is lazy and never throws on construction.

it('returns the command result when Redis answers', async () => {
  const out = await redisTry(async () => 7, 0)
  expect(out).toBe(7)
})

it('returns the fallback instead of hanging when the command never settles', async () => {
  // This is the production failure: a promise that never resolves.
  const start = Date.now()
  const out = await redisTry(() => new Promise<number>(() => {}), 99, 120)
  expect(out).toBe(99)
  expect(Date.now() - start).toBeLessThan(1000)
})

it('returns the fallback when the command throws', async () => {
  const out = await redisTry(async () => {
    throw new Error('ECONNREFUSED')
  }, 42)
  expect(out).toBe(42)
})

it('defaults to a deadline short enough for a request path', async () => {
  const start = Date.now()
  await redisTry(() => new Promise<number>(() => {}), 0)
  const elapsed = Date.now() - start
  // A user waiting on a rate-limit check should never feel it.
  expect(elapsed).toBeLessThan(3000)
})

it('does not leave a timer holding the event loop open', async () => {
  // If the timeout is not cleared on the fast path, jest warns about open
  // handles and a serverless invocation is held alive for the full window.
  const out = await redisTry(async () => 'fast', 'slow', 5000)
  expect(out).toBe('fast')
})
