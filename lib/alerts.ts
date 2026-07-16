/**
 * lib/alerts.ts — founder error alerting (P0.4 of docs/MASTER_PLAN.md).
 *
 * sendAdminAlert() publishes an `admin_alert` event to the Redis
 * `application_events` channel; the notifier service relays it to the
 * founder's Telegram chat (ADMIN_TELEGRAM_CHAT_ID).
 *
 * Storm protection: identical alerts (same `key`) are deduped via Redis to at
 * most one per hour, and the notifier applies its own per-chat rate limit on
 * top. Strictly fire-and-forget — an alerting failure must never break the
 * request that triggered it.
 */
import { getRedis, publishEvent } from '@/lib/redis'

const DEDUPE_TTL_SECONDS = 3600

export async function sendAdminAlert(text: string, key?: string): Promise<void> {
  try {
    const dedupeKey = `alert:dedupe:${key ?? text.slice(0, 120)}`
    // SET NX EX — returns null when the key already exists (recently alerted)
    const first = await getRedis().set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX')
    if (first === null) return
    await publishEvent('application_events', { type: 'admin_alert', text })
  } catch (err: any) {
    console.warn('[alerts] sendAdminAlert failed (non-fatal):', err?.message)
  }
}
