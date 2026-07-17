/**
 * lib/rescue/generate.ts — Resume Rescue order processing (Revenue Sprint A2).
 *
 * processRescueOrder() is the single entry point that takes a PAID order to
 * DELIVERED (or REFUNDED). It is called from two places:
 *   1. /api/rescue/[id]/status — the result page polls after payment, and the
 *      first poll triggers generation inline (~30-90s on this self-hosted box)
 *   2. the run-campaigns cron — safety net for buyers who closed the tab
 *
 * Guarantees:
 *   - Redis lock: only one generation per order runs at a time
 *   - max 2 attempts (i.e. one regeneration), then AUTO-REFUND + apology
 *     email + founder Telegram alert — the buyer never pays for nothing
 *   - the worker caches the bundle by (resume, job), so retries and repeat
 *     requests never double-spend on OpenAI
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { sendAdminAlert } from '@/lib/alerts'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { sendRescueApologyEmail, sendRescueDeliveryEmail } from '@/lib/rescue/emails'
import { stripe } from '@/lib/stripe'
import { callWorker } from '@/lib/worker-client'
import type { RescueOrder } from '@prisma/client'

const MAX_ATTEMPTS = 2
const LOCK_TTL_SECONDS = 300

interface RescueBundle {
  tailored_resume: Record<string, unknown>
  fit_report: Record<string, unknown>
  tokens_used: number
  cached: boolean
}

/** Create the 72h single-use "Pro first month $9" upsell promo. Best-effort. */
async function createUpsellPromo(orderId: string): Promise<{ id: string; expiresAt: Date } | null> {
  try {
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000)
    const coupon = await stripe.coupons.create({
      amount_off: 1000,
      currency: 'usd',
      duration: 'once',
      name: 'Resume Rescue upsell — Pro first month $9',
    })
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      max_redemptions: 1,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      metadata: { rescueOrderId: orderId },
    })
    return { id: promo.id, expiresAt }
  } catch (err) {
    console.error('[rescue] upsell promo creation failed (non-fatal):', err)
    return null
  }
}

async function refundAndApologize(order: RescueOrder, reason: string): Promise<void> {
  let refunded = false
  if (order.paymentIntentId) {
    try {
      await stripe.refunds.create({ payment_intent: order.paymentIntentId })
      refunded = true
    } catch (err) {
      console.error('[rescue] auto-refund FAILED for order', order.id, err)
    }
  }
  await prisma.rescueOrder.update({
    where: { id: order.id },
    data: { status: refunded ? 'REFUNDED' : 'FAILED', error: reason.slice(0, 500) },
  })
  await sendRescueApologyEmail(order.email, refunded).catch((err) =>
    console.error('[rescue] apology email failed:', err),
  )
  await sendAdminAlert(
    `Resume Rescue order ${order.id} FAILED after ${order.attempts} attempts` +
      `\nreason: ${reason.slice(0, 200)}` +
      `\nrefund: ${refunded ? 'issued automatically' : 'FAILED - refund manually in Stripe!'}`,
    `rescue-failed:${order.id}`,
  )
}

/**
 * Advance a PAID/GENERATING order. Returns the fresh order row (or null when
 * another runner holds the lock — callers just report current status).
 */
export async function processRescueOrder(orderId: string): Promise<RescueOrder | null> {
  const lockKey = `rescue:lock:${orderId}`
  const gotLock = await getRedis().set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (gotLock === null) return null

  try {
    const order = await prisma.rescueOrder.findUnique({ where: { id: orderId } })
    if (!order || (order.status !== 'PAID' && order.status !== 'GENERATING')) {
      return order
    }

    if (order.attempts >= MAX_ATTEMPTS) {
      await refundAndApologize(order, order.error ?? 'generation failed repeatedly')
      return prisma.rescueOrder.findUnique({ where: { id: orderId } })
    }

    const attempt = order.attempts + 1
    await prisma.rescueOrder.update({
      where: { id: orderId },
      data: { status: 'GENERATING', attempts: attempt },
    })

    try {
      const bundle = await callWorker<RescueBundle>('/jobs/resume-rescue', {
        resume_text: order.resumeText,
        job: {
          title: order.jobTitle,
          company: order.jobCompany ?? '',
          description: order.jobDescription ?? '',
          url: order.jobUrl ?? '',
        },
        order_id: order.id,
      })

      // Deliverable 1: a real Resume row in the buyer's account — the existing
      // PDF stack (all 5 templates, template picker, download route) now works
      // for it with zero extra code.
      let resumeId = order.resumeId
      if (!resumeId && order.userId) {
        const resume = await prisma.resume.create({
          data: {
            userId: order.userId,
            title: `Rescue: ${order.jobTitle}`.slice(0, 120),
            targetRole: order.jobTitle.slice(0, 120),
            input: { source: 'resume_rescue', orderId: order.id },
            generated: bundle.tailored_resume as object,
          },
        })
        resumeId = resume.id
      }

      const upsell = await createUpsellPromo(order.id)

      const delivered = await prisma.rescueOrder.update({
        where: { id: orderId },
        data: {
          status: 'DELIVERED',
          resumeId,
          fitReport: bundle.fit_report as object,
          deliveredAt: new Date(),
          error: null,
          ...(upsell ? { upsellPromoId: upsell.id, upsellExpiresAt: upsell.expiresAt } : {}),
        },
      })

      await sendRescueDeliveryEmail(delivered).catch((err) =>
        console.error('[rescue] delivery email failed (order delivered anyway):', err),
      )
      await trackEvent({
        event: 'tripwire_delivered',
        userId: order.userId ?? undefined,
        properties: {
          orderId: order.id,
          attempt,
          cached: bundle.cached,
          tokensUsed: bundle.tokens_used,
          minutesFromPayment: order.paidAt
            ? Math.round((Date.now() - order.paidAt.getTime()) / 60000)
            : null,
        },
      }).catch(() => {})

      return delivered
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[rescue] generation attempt ${attempt} failed for ${orderId}:`, reason)

      if (attempt >= MAX_ATTEMPTS) {
        const fresh = await prisma.rescueOrder.findUnique({ where: { id: orderId } })
        if (fresh) await refundAndApologize({ ...fresh, attempts: attempt }, reason)
      } else {
        // Back to PAID so the next poll/cron retries once more.
        await prisma.rescueOrder.update({
          where: { id: orderId },
          data: { status: 'PAID', error: reason.slice(0, 500) },
        })
      }
      return prisma.rescueOrder.findUnique({ where: { id: orderId } })
    }
  } finally {
    await getRedis()
      .del(lockKey)
      .catch(() => {})
  }
}

/**
 * Cron safety net: deliver PAID orders whose buyer closed the tab (no poll
 * has driven them for >3 minutes). Called from the run-campaigns cron.
 */
export async function processStaleRescueOrders(limit = 2): Promise<number> {
  const stale = await prisma.rescueOrder.findMany({
    where: {
      status: 'PAID',
      paidAt: { lt: new Date(Date.now() - 3 * 60_000) },
    },
    orderBy: { paidAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  let processed = 0
  for (const { id } of stale) {
    const result = await processRescueOrder(id)
    if (result) processed++
  }
  return processed
}
