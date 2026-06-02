/**
 * POST /api/inbox/inbound
 *
 * Resend inbound-email webhook.  Called by Resend whenever a message
 * arrives at *@inbox.resumeai-bot.ru.
 *
 * Flow:
 *  1. Verify Resend-Signature (HMAC-SHA256; skip when RESEND_WEBHOOK_SECRET
 *     is not set — safe for local dev, must be set in production).
 *  2. Parse from / to / subject / body from the Resend payload.
 *  3. Extract inboxHandle (and optional applicationId from plus-addressing)
 *     from the "to" address.
 *  4. Look up the User by inboxHandle.
 *  5. Classify with AI (gpt-4o-mini) or regex fast-path.
 *  6. Persist InboxMessage row.
 *  7. Side-effects:
 *       INTERVIEW_REQUEST → ApplicationEvent + set application.status=INTERVIEW
 *       REJECTION         → set application.status=REJECTED
 *  8. Return 200 to stop Resend retries.
 *
 * Auth: Resend-Signature: v1=<hex-hmac> header (HMAC-SHA256 of raw body)
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { classifyEmail } from '@/lib/inbox/classify'
import { notifyHumanReply, shouldNotify } from '@/lib/inbox/notify'
import { verifyResendSignature, parseFrom, parseToAddress } from '@/lib/inbox/inbound-utils'
import { publishEvent } from '@/lib/redis'

const INBOX_DOMAIN = process.env.INBOX_DOMAIN ?? 'inbox.resumeai-bot.ru'

// ── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const rawBody = await req.text()

  // ── 1. Signature verification ───────────────────────────────────────────
  // Resend inbound uses Svix for webhook delivery. Svix signs the message
  // as "{svix-id}.{svix-timestamp}.{body}" with the base64-decoded whsec_ secret.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (webhookSecret) {
    const sig = req.headers.get('svix-signature') ?? req.headers.get('resend-signature')
    const msgId        = req.headers.get('svix-id')
    const msgTimestamp = req.headers.get('svix-timestamp')
    if (!verifyResendSignature(rawBody, sig, webhookSecret, msgId, msgTimestamp)) {
      console.warn('[inbox/inbound] signature verification failed')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── 2. Parse payload ────────────────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resend inbound payload is a Svix event:
  //   { type: "email.received", data: { from, to, subject, text, html, ... } }
  // Fall back to the flat root for older/alternative formats.
  const data = (
    payload.data && typeof payload.data === 'object'
      ? payload.data
      : payload
  ) as Record<string, unknown>

  const rawTo: string = Array.isArray(data.to)
    ? String(data.to[0] ?? '')
    : String(data.to ?? '')

  const rawFrom: string = String(data.from ?? '')
  const subject: string = String(data.subject ?? '(no subject)')
  const bodyText: string = String(data.text ?? data.plain_text ?? '')
  const bodyHtml: string | null = data.html ? String(data.html) : null

  // ── 3. Extract handle + applicationId ──────────────────────────────────
  const parsed = parseToAddress(rawTo, INBOX_DOMAIN)
  if (!parsed) {
    // Not addressed to our inbox domain — nothing to do; 200 to stop retries
    console.warn('[inbox/inbound] unrecognised to address', rawTo)
    return NextResponse.json({ ok: true, skipped: 'unknown_domain' })
  }

  // ── 4. Look up user ─────────────────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { inboxHandle: parsed.handle },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    console.warn('[inbox/inbound] no user for handle', parsed.handle)
    return NextResponse.json({ ok: true, skipped: 'unknown_handle' })
  }

  const { fromName, fromEmail } = parseFrom(rawFrom)

  // ── 5. Resolve which application this reply belongs to ──────────────────
  // Preferred: explicit applicationId from plus-addressing (handle+appId@…).
  // Fallback: most senders reply to the bare handle, so heuristically match the
  // sender's company against the user's recent submitted applications. This is
  // what lets status updates + notifications work without plus-addressing.
  let applicationId: string | null = null
  if (parsed.applicationId) {
    const app = await prisma.jobApplication.findFirst({
      where: { id: parsed.applicationId, userId: user.id },
      select: { id: true },
    })
    applicationId = app?.id ?? null
  }
  if (!applicationId) {
    applicationId = await matchApplicationByCompany(user.id, fromEmail, fromName, subject)
  }

  // ── 6. Classify ─────────────────────────────────────────────────────────
  const { classification } = await classifyEmail({ fromEmail, subject, bodyText })

  // ── 7. Persist ──────────────────────────────────────────────────────────
  const message = await prisma.inboxMessage.create({
    data: {
      userId: user.id,
      applicationId,
      fromEmail,
      fromName,
      subject,
      bodyText,
      bodyHtml,
      classification,
    },
  })

  // ── 8. Side-effects based on classification ─────────────────────────────
  // Status transitions only apply when we could tie the reply to a specific
  // application (plus-address or company heuristic).
  if (applicationId) {
    try {
      if (classification === 'INTERVIEW_REQUEST') {
        await prisma.jobApplication.update({
          where: { id: applicationId },
          data: { status: 'INTERVIEW', responseAt: new Date() },
        })
        await prisma.applicationEvent.create({
          data: {
            applicationId,
            type: 'interview_requested',
            payload: { messageId: message.id, fromEmail },
          },
        })
      } else if (classification === 'REJECTION') {
        await prisma.jobApplication.update({
          where: { id: applicationId },
          data: { status: 'REJECTED', responseAt: new Date() },
        })
        await prisma.applicationEvent.create({
          data: {
            applicationId,
            type: 'rejected',
            payload: { messageId: message.id, fromEmail },
          },
        })
      } else if (classification === 'QUESTION') {
        await prisma.applicationEvent.create({
          data: {
            applicationId,
            type: 'recruiter_question',
            payload: { messageId: message.id, fromEmail },
          },
        })
      }
    } catch (err) {
      console.error('[inbox/inbound] status side-effect failed', err)
    }
  }

  // ── 9. Notify the user (and admins) of any *human* reply ────────────────
  // Fires regardless of whether we linked an application, so a real reply is
  // never silently buried. Best-effort: never blocks the 200 response.
  if (shouldNotify(classification)) {
    try {
      await Promise.all([
        notifyHumanReply({
          userEmail: user.email,
          classification,
          fromName,
          fromEmail,
          subject,
          company: fromName,
        }),
        publishEvent('application_events', {
          type: 'human_reply',
          classification,
          userId: user.id,
          applicationId,
          company: fromName || fromEmail,
          timestamp: new Date().toISOString(),
        }),
      ])
    } catch (err) {
      console.error('[inbox/inbound] notification failed', err)
    }
  }

  console.log('[inbox/inbound] saved', {
    messageId: message.id,
    userId: user.id,
    handle: parsed.handle,
    classification,
    applicationId,
  })

  return NextResponse.json({ ok: true, messageId: message.id })
}

// ── Helpers ──────────────────────────────────────────────────────────────

// ATS / mail-relay domains whose second-level name is NOT the hiring company.
const RELAY_DOMAINS = new Set([
  'greenhouse-mail', 'greenhouse', 'lever', 'myworkday', 'workday', 'ashbyhq',
  'ashby', 'smartrecruiters', 'icims', 'jobvite', 'gmail', 'googlemail',
  'outlook', 'hotmail', 'yahoo', 'resend', 'amazonses', 'sendgrid',
])

/**
 * Best-effort: link a reply to one of the user's recent submitted applications
 * by matching the sender's company against JobApplication.company. Returns the
 * id of the most recent match, or null. Conservative — only matches on a
 * meaningful (≥3 char) company token, never on relay/ATS domains.
 */
async function matchApplicationByCompany(
  userId: string,
  fromEmail: string,
  fromName: string | null,
  subject: string,
): Promise<string | null> {
  const domain = (fromEmail.split('@')[1] || '').toLowerCase()
  const labels = domain.split('.').filter(Boolean)
  // Second-level label is usually the company (gusto.com → "gusto",
  // recruiting.intercom.com → "intercom").
  const sld = labels.length >= 2 ? labels[labels.length - 2] : ''

  const candidates = [sld, fromName?.toLowerCase() ?? '']
    .map((c) => c.trim())
    .filter((c) => c.length >= 3 && !RELAY_DOMAINS.has(c))

  for (const token of candidates) {
    const app = await prisma.jobApplication.findFirst({
      where: {
        userId,
        company: { contains: token, mode: 'insensitive' },
        status: { in: ['SUBMITTED', 'QUEUED', 'INTERVIEW'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (app) return app.id
  }

  // Last resort: a company name mentioned in the subject (e.g. "… at Acme").
  void subject
  return null
}
