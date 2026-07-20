/**
 * lib/alerts.ts — founder Telegram messaging (P0.4 + Session D).
 *
 * Publishes an `admin_alert` event to the Redis `application_events` channel;
 * the notifier relays it to the founder's Telegram (ADMIN_TELEGRAM_CHAT_ID).
 * The payload carries an optional title/emoji so routine reports (daily pulse,
 * money alerts, SEO watch) don't wear the error siren.
 *
 * Storm protection: identical messages (same `key`) are deduped via Redis, and
 * the notifier applies its own per-chat rate limit on top. Strictly
 * fire-and-forget — a messaging failure must never break the caller.
 */
import { getRedis, publishEvent } from '@/lib/redis'

const DEDUPE_TTL_SECONDS = 3600

interface AdminMessageOpts {
  /** Dedupe key; identical keys within `dedupeSeconds` send once. */
  key?: string
  /** Bold header title (default "ResumeAI alert"). */
  title?: string
  /** Leading emoji (default the error siren). */
  emoji?: string
  /** Dedupe window in seconds (default 1h). Use a short window for pulses. */
  dedupeSeconds?: number
}

/** Low-level publisher. Returns true if actually sent (not deduped). */
export async function sendAdminMessage(text: string, opts: AdminMessageOpts = {}): Promise<boolean> {
  try {
    const dedupeKey = `alert:dedupe:${opts.key ?? text.slice(0, 120)}`
    const ttl = opts.dedupeSeconds ?? DEDUPE_TTL_SECONDS
    // SET NX EX — returns null when the key already exists (recently sent)
    const first = await getRedis().set(dedupeKey, '1', 'EX', ttl, 'NX')
    if (first === null) return false
    await publishEvent('application_events', {
      type: 'admin_alert',
      text,
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.emoji ? { emoji: opts.emoji } : {}),
    })
    return true
  } catch (err: any) {
    console.warn('[alerts] sendAdminMessage failed (non-fatal):', err?.message)
    return false
  }
}

/** Error alert (siren) — the original P0.4 signature, unchanged for callers. */
export async function sendAdminAlert(text: string, key?: string): Promise<void> {
  await sendAdminMessage(text, { key })
}
