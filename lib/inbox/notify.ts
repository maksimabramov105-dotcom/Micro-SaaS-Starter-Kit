/**
 * lib/inbox/notify.ts
 *
 * Sends the user (and optionally the admin) an email when a *human* reply to a
 * job application arrives — an interview invite, a rejection, or a question.
 * Automated confirmations/receipts never trigger a notification.
 *
 * This closes the loop that was previously broken: real recruiter replies were
 * persisted to the inbox but the user was never told, so they appeared to "get
 * no responses".
 */

import { sendEmail } from '@/lib/email'
import type { InboxClassification } from './classify'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'ResumeAI'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://resumeai-bot.ru'

// Which classifications are worth interrupting the user for.
const NOTIFY: Record<string, { label: string; emoji: string; blurb: string }> = {
  INTERVIEW_REQUEST: {
    label: 'Interview request',
    emoji: '🎉',
    blurb: "Great news — a company wants to move forward. Open your inbox to read it and reply.",
  },
  REJECTION: {
    label: 'Application update',
    emoji: '📩',
    blurb: "A company responded about your application. Open your inbox to read the details.",
  },
  QUESTION: {
    label: 'Recruiter question',
    emoji: '❓',
    blurb: "A recruiter is asking for more information. Reply soon to keep things moving.",
  },
}

export function shouldNotify(classification: InboxClassification): boolean {
  return classification in NOTIFY
}

interface NotifyParams {
  userEmail: string | null | undefined
  classification: InboxClassification
  fromName: string | null
  fromEmail: string
  subject: string
  company?: string | null
}

/**
 * Fire-and-(soft)-forget: emails the user about a real reply, and CCs the admin
 * list so the founder sees early traction. Never throws — callers must not let
 * a notification failure break the inbound webhook.
 */
export async function notifyHumanReply(params: NotifyParams): Promise<void> {
  const meta = NOTIFY[params.classification]
  if (!meta) return

  const sender = params.fromName ? `${params.fromName} <${params.fromEmail}>` : params.fromEmail
  const subjectLine = `${meta.emoji} ${meta.label}: ${params.subject}`
  const inboxUrl = `${APP_URL}/dashboard/inbox`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color:#111;font-size:20px;">${meta.emoji} ${meta.label}</h1>
      <p>${meta.blurb}</p>
      <table style="margin:16px 0;font-size:14px;color:#333;border-collapse:collapse;">
        <tr><td style="padding:2px 12px 2px 0;color:#777;">From</td><td>${escapeHtml(sender)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#777;">Subject</td><td>${escapeHtml(params.subject)}</td></tr>
        ${params.company ? `<tr><td style="padding:2px 12px 2px 0;color:#777;">Company</td><td>${escapeHtml(params.company)}</td></tr>` : ''}
      </table>
      <a href="${inboxUrl}"
         style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;margin:8px 0;">
        Open your inbox →
      </a>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        You're receiving this because ${APP_NAME} is auto-applying to jobs for you and detected a reply.
      </p>
    </div>`

  const recipients = new Set<string>()
  if (params.userEmail) recipients.add(params.userEmail)
  // CC the founder/admins so early responses are visible during launch.
  ;(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .forEach((e) => recipients.add(e))

  await Promise.all(
    [...recipients].map((to) =>
      sendEmail({ to, subject: subjectLine, html }).catch((err) =>
        console.error('[inbox/notify] send failed for', to, err),
      ),
    ),
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
