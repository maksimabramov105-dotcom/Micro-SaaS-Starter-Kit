/**
 * lib/referral/emails.ts
 *
 * Referral email triggers:
 *  - sendReferralQualifiedEmail  → referrer earned a free month of Pro
 *  - sendReferralReceivedEmail   → referee, at signup: who invited you
 *
 * Neither email may describe an offer that ./offer.ts does not define. The
 * referee mail spent six weeks promising a $20 credit that had been removed
 * from the code; __tests__/lib/referral-claims.test.ts now fails if any copy
 * drifts back.
 */

import { sendEmail } from '@/lib/email'
import { freeMonthsLabel } from './offer'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'ResumeAI'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.com'

// ── Referrer: "you earned a free month of Pro" ───────────────────────────────

interface ReferralQualifiedOptions {
  to: string
  referrerName: string | null | undefined
  freeMonths: number  // months of Pro, free
}

export async function sendReferralQualifiedEmail({
  to,
  referrerName,
  freeMonths,
}: ReferralQualifiedOptions) {
  const name = referrerName ?? 'there'
  const label = freeMonthsLabel(freeMonths)

  const subject = `🎉 You earned ${label} — a friend just got a year of Pro!`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
      <h2 style="color:#111">You earned ${label}! 🎉</h2>
      <p>Hi ${name},</p>
      <p>
        Great news: a friend you referred just subscribed to a <strong>year of ${APP_NAME} Pro</strong>.
        We've added <strong>${label}</strong> to your account — it applies automatically to your
        next Pro invoice (or your first, if you upgrade later).
      </p>
      <p>
        Keep sharing! Every friend who gets a year of Pro earns you another free month.
      </p>
      <a href="${APP_URL}/dashboard/referrals"
         style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
                text-decoration:none;border-radius:6px;margin:16px 0">
        View your referral stats
      </a>
      <p style="color:#666;font-size:13px">
        Questions? Reply to this email or contact
        <a href="mailto:support@resumeai-bot.com">support@resumeai-bot.com</a>.
      </p>
      <p>Best,<br>The ${APP_NAME} Team</p>
    </div>
  `

  return sendEmail({ to, subject, html })
}

// ── Referee: "here is who invited you" ───────────────────────────────────────
//
// Deliberately offers the referred user nothing, because the program gives them
// nothing — the free month goes to the referrer. It also stays off the welcome
// email's ground: lib/lifecycle sends that one seconds earlier and it is the
// one that says what to do first, so this note does not repeat the CTA.

interface ReferralReceivedOptions {
  to: string
  refereeName: string | null | undefined
  referrerName: string | null | undefined
}

export async function sendReferralReceivedEmail({
  to,
  refereeName,
  referrerName,
}: ReferralReceivedOptions) {
  const name = refereeName ?? 'there'
  const referrer = referrerName ?? 'A friend'

  const subject = `${referrer} invited you to ${APP_NAME}`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
      <h2 style="color:#111">${referrer} invited you to ${APP_NAME}</h2>
      <p>Hi ${name},</p>
      <p>
        You signed up through <strong>${referrer}</strong>'s link, so here is the
        one thing worth knowing about us up front: we never mark an application
        as sent unless the employer's ATS confirmed it. Everything else follows
        from that.
      </p>
      <p style="color:#666;font-size:13px">
        Full disclosure on the link you used: if you ever subscribe to a year of
        Pro, ${referrer} gets ${freeMonthsLabel()} as a thank-you. It costs you
        nothing and changes nothing about your price — see the referral section
        of our <a href="${APP_URL}/terms">terms</a>.
      </p>
      <p style="color:#666;font-size:13px">
        Questions? Just reply, or write to
        <a href="mailto:support@resumeai-bot.com">support@resumeai-bot.com</a>.
      </p>
      <p>Best,<br>The ${APP_NAME} Team</p>
    </div>
  `

  return sendEmail({ to, subject, html })
}
