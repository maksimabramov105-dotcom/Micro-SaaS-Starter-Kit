/**
 * lib/rescue/emails.ts — transactional emails for Resume Rescue (A2).
 * Plain founder-voice HTML, no template framework.
 */
import { sendEmail } from '@/lib/email'
import { PRICE } from '@/lib/pricing'
import type { RescueOrder } from '@prisma/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export async function sendRescueDeliveryEmail(order: RescueOrder): Promise<void> {
  const resultUrl = `${APP_URL}/resume-rescue/result?order=${order.id}`
  const upsellUrl = `${APP_URL}/api/rescue/${order.id}/upsell`
  const report = (order.fitReport ?? {}) as { score?: number }

  const upsellBlock = order.upsellPromoId
    ? `<p style="margin-top:24px;padding:16px;background:#f5f7ff;border-radius:8px;">
        <b>One more thing:</b> for the next 72 hours you can get your first month of
        Pro for <b>${PRICE.upsellFirstMonth}</b> (normally ${PRICE.proMonthly}) — unlimited tailoring for every job you
        apply to, 25 verified auto-applications/day, and a reply inbox.<br/>
        <a href="${upsellUrl}">Claim the ${PRICE.upsellFirstMonth} first month &rarr;</a>
      </p>`
    : ''

  await sendEmail({
    to: order.email,
    subject: `Your rescued resume for "${order.jobTitle}" is ready`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;line-height:1.6;">
        <h2>Your resume rescue is ready</h2>
        <p>We rewrote your resume specifically for
          <b>${escapeHtml(order.jobTitle)}</b>${order.jobCompany ? ` at <b>${escapeHtml(order.jobCompany)}</b>` : ''}
          and ran the fit analysis${typeof report.score === 'number' ? ` (fit score: <b>${report.score}/100</b>)` : ''}.</p>
        <p><a href="${resultUrl}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">
          View your resume + fit report &rarr;</a></p>
        <p>The tailored resume lives in your account — you can switch between all
          5 PDF templates and download it as many times as you like. Sign in with
          this email address (magic link) to access it any time.</p>
        ${upsellBlock}
        <p style="color:#888;font-size:13px;margin-top:28px;">
          Something not right? Just reply — a human reads this inbox, and there is
          a 30-day money-back guarantee on everything we sell.</p>
      </div>`,
  })
}

/**
 * Three-state, because "not refunded" is not one thing: an order that was fully
 * discounted to $0 has no captured payment to refund, and telling that customer
 * a refund is on its way is a promise we can never keep.
 */
export type RefundOutcome = 'refunded' | 'nothing-to-refund' | 'failed'

const APOLOGY_SUBJECT: Record<RefundOutcome, string> = {
  refunded: 'Your Resume Rescue failed on our side — full refund issued',
  'nothing-to-refund': 'Your Resume Rescue failed on our side — you were not charged',
  failed: 'Your Resume Rescue failed on our side — refund on its way',
}

const APOLOGY_MONEY_LINE: Record<RefundOutcome, string> = {
  refunded:
    '<b>Your payment has been refunded in full automatically.</b> Depending on your bank it can take 5-10 business days to appear.',
  'nothing-to-refund':
    '<b>You were not charged for this order</b>, so there is nothing to refund.',
  failed: '<b>Your refund is being processed manually right now</b> and will be issued within 24 hours.',
}

export async function sendRescueApologyEmail(
  email: string,
  outcome: RefundOutcome,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: APOLOGY_SUBJECT[outcome],
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;line-height:1.6;">
        <h2>We could not generate your resume — sorry</h2>
        <p>Something broke on our side while generating your tailored resume, and it
          did not complete within our quality bar.</p>
        <p>${APOLOGY_MONEY_LINE[outcome]}</p>
        <p>If you would like us to try again once, just reply to this email — no
          extra charge either way.</p>
        <p style="color:#888;font-size:13px;">— Maxim, founder</p>
      </div>`,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
