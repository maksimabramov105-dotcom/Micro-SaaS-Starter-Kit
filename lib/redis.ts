/**
 * lib/redis.ts — Shared ioredis client for pub/sub and job queues.
 *
 * Exports:
 *   getRedis()           — singleton ioredis connection (lazy)
 *   publishEvent(ch, p)  — fire-and-forget pub to a Redis channel
 *
 * Used by:
 *   lib/quota.ts          → publishes application_submitted
 *   app/api/inbox/…       → publishes interview_reply
 *   BullMQ queues (lib/jobs.ts) — keep their own connection
 */
import Redis from 'ioredis'

let _client: Redis | null = null

export function getRedis(): Redis {
  if (!_client) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'
    _client = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      // Don't crash the process if Redis is unreachable; pub/sub is best-effort
      reconnectOnError: () => true,
    })
    _client.on('error', (err) => {
      console.warn('[redis] connection error (non-fatal):', err.message)
    })
  }
  return _client
}

/**
 * Run a Redis command with a hard deadline, returning `fallback` if it does not
 * finish in time (or throws).
 *
 * WHY THIS EXISTS: the client is configured with `maxRetriesPerRequest: null`,
 * which makes ioredis QUEUE commands indefinitely while disconnected instead of
 * rejecting them. Every request-path rate limiter wrapped its call in
 * try/catch expecting to fail open — but the catch can never fire, because the
 * promise never settles. It just waits.
 *
 * Proven in the launch audit: with Redis stopped, POST /api/ats-check hung for
 * the full 45s client timeout and returned nothing. The user gets a spinner
 * forever. Compare the worker outage, which correctly returns a friendly 503
 * in five seconds.
 *
 * Rate limiting is not worth an outage: when Redis is unavailable we let the
 * request through rather than block it.
 */
export async function redisTry<T>(
  fn: (client: Redis) => Promise<T>,
  fallback: T,
  timeoutMs = 1500,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(getRedis()),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Publish a JSON payload to a Redis pub/sub channel.
 * Never throws — silently swallowed so a Redis outage never breaks the
 * primary request path.
 */
export async function publishEvent(
  channel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await getRedis().publish(channel, JSON.stringify(payload))
  } catch (err: any) {
    console.warn(`[redis] publish to ${channel} failed (non-fatal):`, err.message)
  }
}
