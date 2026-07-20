/**
 * lib/ops/self-check.ts — autonomous money-path health monitor (Session D4).
 *
 * The same three checks smoke.sh runs at deploy time, but on a ~6h loop from
 * the hourly cron and alerting the founder's Telegram (P0.4) on failure —
 * silent on success. Complements the seo-health cron (which covers page 404s)
 * with the parts a broken deploy would silently take down: the tripwire page,
 * the fit-check API, and the Stripe webhook's signature verification.
 */
import { createHmac } from 'crypto'
import { sendAdminAlert } from '@/lib/alerts'
import { trackEvent } from '@/lib/analytics-advanced'
import { prisma } from '@/lib/prisma'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
const FIT_CHECK_BUDGET_MS = 5000

export interface SelfCheckResult {
  ok: boolean
  failures: string[]
}

/** 1. Tripwire page renders with its price on it. */
async function checkTripwirePage(): Promise<string | null> {
  try {
    const res = await fetch(`${APP_URL}/resume-rescue`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (res.status !== 200) return `tripwire page HTTP ${res.status}`
    const body = await res.text()
    if (!body.includes('$4.99')) return 'tripwire page missing price ($4.99)'
    return null
  } catch (err) {
    return `tripwire page unreachable: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * 2. Fit-check API answers within budget. Sends a deliberately-too-short body
 * to get a fast structured 400 — proves the route + JSON handling + latency
 * without burning the AI quota or the 3/IP/day rate limit on every run.
 */
async function checkFitCheckApi(): Promise<string | null> {
  const started = Date.now()
  try {
    const res = await fetch(`${APP_URL}/api/ats-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeText: 'x', jobDescription: 'y' }),
      signal: AbortSignal.timeout(FIT_CHECK_BUDGET_MS + 2000),
    })
    const ms = Date.now() - started
    if (ms > FIT_CHECK_BUDGET_MS) return `fit-check API slow: ${ms}ms > ${FIT_CHECK_BUDGET_MS}ms`
    // Too-short input must return a structured 400 (route alive + validating).
    if (res.status !== 400) return `fit-check API unexpected HTTP ${res.status}`
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!data.error) return 'fit-check API returned no structured error'
    return null
  } catch (err) {
    return `fit-check API failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * 3. Stripe webhook returns 200 on a properly SIGNED test event. Signs a
 * harmless unhandled event (fixed id → recorded once, then idempotent) with
 * STRIPE_WEBHOOK_SECRET, exactly as Stripe would. A broken signature path or
 * a down endpoint fails this.
 */
async function checkStripeWebhook(): Promise<string | null> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return null // nothing to test against; not a failure
  try {
    const payload = JSON.stringify({
      id: 'evt_selfcheck',
      object: 'event',
      type: 'balance.available', // unhandled → default case → 200
      data: { object: {} },
    })
    const ts = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')
    const res = await fetch(`${APP_URL}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status !== 200) return `stripe webhook HTTP ${res.status} on signed test event`
    return null
  } catch (err) {
    return `stripe webhook check failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

export async function runOpsSelfCheck(): Promise<SelfCheckResult> {
  const results = await Promise.all([checkTripwirePage(), checkFitCheckApi(), checkStripeWebhook()])
  const failures = results.filter((r): r is string => r !== null)
  return { ok: failures.length === 0, failures }
}

/** Called from the hourly cron. Runs ~every 6h; alerts (P0.4) only on failure. */
export async function maybeRunOpsSelfCheck(): Promise<'ran' | 'skipped'> {
  const recent = await prisma.analyticsEvent.findFirst({
    where: { event: 'ops_selfcheck_ran', createdAt: { gte: new Date(Date.now() - 5 * 3600_000) } },
    select: { id: true },
  })
  if (recent) return 'skipped'

  const result = await runOpsSelfCheck()
  await trackEvent({
    event: 'ops_selfcheck_ran',
    properties: { ok: result.ok, failures: result.failures },
  }).catch(() => {})

  if (!result.ok) {
    await sendAdminAlert(
      `Money-path self-check FAILED:\n${result.failures.map((f) => `- ${f}`).join('\n')}`,
      'ops-selfcheck-fail',
    )
  }
  return 'ran'
}
