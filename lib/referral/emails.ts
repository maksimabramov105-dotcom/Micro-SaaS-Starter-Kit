/**
 * lib/referral/emails.ts
 *
 * Referral email triggers:
 *  - sendReferralQualifiedEmail  → referrer earns $20 when friend pays
 *  - sendReferralReceivedEmail   → referee welcome when they sign up via referral
 */

import { sendEmail } from '@/lib/email'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'ResumeAI'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

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
  const label = freeMonths === 1 ? '1 free month of Pro' : `${freeMonths} free months of Pro`

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
        <a href="mailto:support@resumeai-bot.ru">support@resumeai-bot.ru</a>.
      </p>
      <p>Best,<br>The ${APP_NAME} Team</p>
    </div>
  `

  return sendEmail({ to, subject, html })
}

// ── Referee: welcome + "$20 credit when you subscribe" ───────────────────────

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
  const referrer = referrerName ?? 'a friend'

  const subject = `${referrer} gave you $20 off ${APP_NAME} 🎁`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
      <h2 style="color:#111">Welcome! You have a $20 gift waiting 🎁</h2>
      <p>Hi ${name},</p>
      <p>
        <strong>${referrer}</strong> invited you to ${APP_NAME} and gave you a
        <strong>$20 credit</strong> toward your first paid plan.
        The credit will be applied automatically when you subscribe — no code needed.
      </p>
      <p>
        ${APP_NAME} helps you generate AI-powered resumes and automates your job applications
        on LinkedIn and other platforms.
      </p>
      <a href="${APP_URL}/pricing"
         style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
                text-decoration:none;border-radius:6px;margin:16px 0">
        Claim your $20 credit
      </a>
      <p style="color:#666;font-size:13px">
        The credit is applied to your first month. Subject to our
        <a href="${APP_URL}/terms">terms of service</a>.
      </p>
      <p>Best,<br>The ${APP_NAME} Team</p>
    </div>
  `

  return sendEmail({ to, subject, html })
}
