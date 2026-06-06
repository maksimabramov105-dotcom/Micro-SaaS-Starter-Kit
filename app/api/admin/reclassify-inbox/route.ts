/**
 * POST /api/admin/reclassify-inbox
 *
 * One-off / maintenance backfill: re-runs the classifier over inbox messages
 * that are currently UNCLASSIFIED or OTHER (the buckets that resulted from the
 * old broken classifier endpoint) and updates their classification. For any
 * that resolve to INTERVIEW_REQUEST / REJECTION it best-effort links the
 * message to a recent application and updates that application's status.
 *
 * Does NOT send notification emails — this is for historical mail, so we don't
 * want to spam the user about week-old messages.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { classifyEmail } from '@/lib/inbox/classify'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '400') || 400, 1000)

  // Re-evaluate AUTOMATED too — historically the body was never stored, so the
  // subject-only classifier dumped real rejections/interviews into AUTOMATED.
  const messages = await prisma.inboxMessage.findMany({
    where: { classification: { in: ['UNCLASSIFIED', 'OTHER', 'AUTOMATED'] } },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: {
      id: true, userId: true, applicationId: true,
      fromEmail: true, fromName: true, subject: true, bodyText: true,
    },
  })

  // Build a (email|subject) → Resend inbound id map so we can fetch missing bodies.
  const bodyIndex = await buildResendIndex()

  const counts: Record<string, number> = {}
  let statusUpdates = 0
  let bodiesFetched = 0

  for (const m of messages) {
    let bodyText = m.bodyText ?? ''
    // Skip obvious security-code emails (definitely automated) to save API calls.
    const isSecurityCode = /security code|verification code/i.test(m.subject)
    if (!bodyText && !isSecurityCode && process.env.RESEND_API_KEY) {
      const id = bodyIndex.get(indexKey(m.fromEmail, m.subject))
      if (id) {
        const fetched = await fetchResendBody(id)
        if (fetched) {
          bodyText = fetched
          bodiesFetched++
          await prisma.inboxMessage.update({ where: { id: m.id }, data: { bodyText } }).catch(() => {})
        }
      }
    }
    const { classification } = await classifyEmail({
      fromEmail: m.fromEmail,
      subject: m.subject,
      bodyText,
    })
    counts[classification] = (counts[classification] ?? 0) + 1

    await prisma.inboxMessage.update({
      where: { id: m.id },
      data: { classification },
    })

    // Backfill application status for decisive replies, best-effort.
    if ((classification === 'INTERVIEW_REQUEST' || classification === 'REJECTION')) {
      const appId = m.applicationId ?? (await matchByCompany(m.userId, m.fromEmail, m.fromName))
      if (appId) {
        await prisma.jobApplication
          .update({
            where: { id: appId },
            data: {
              status: classification === 'INTERVIEW_REQUEST' ? 'INTERVIEW' : 'REJECTED',
              responseAt: new Date(),
            },
          })
          .then(() => { statusUpdates++ })
          .catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true, processed: messages.length, bodiesFetched, counts, statusUpdates })
}

// ── Resend body backfill helpers ────────────────────────────────────────────
function indexKey(fromEmail: string, subject: string): string {
  return `${fromEmail.trim().toLowerCase()}|${subject.trim().toLowerCase()}`
}

/** Map (email|subject) → most-recent Resend inbound id, so we can fetch bodies
 *  the inbound webhook historically failed to store. */
async function buildResendIndex(): Promise<Map<string, string>> {
  const idx = new Map<string, string>()
  const key = process.env.RESEND_API_KEY
  if (!key) return idx
  let url = 'https://api.resend.com/emails/inbound?limit=100'
  try {
    for (let page = 0; page < 5; page++) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
      if (!r.ok) break
      const data = (await r.json()) as { data?: Array<{ id: string; from: string; subject: string }>; has_more?: boolean }
      const rows = data.data ?? []
      for (const row of rows) {
        const email = (row.from.match(/<([^>]+)>/)?.[1] ?? row.from).trim().toLowerCase()
        const k = indexKey(email, row.subject ?? '')
        if (!idx.has(k)) idx.set(k, row.id) // first = most recent
      }
      if (!data.has_more || rows.length === 0) break
      url = `https://api.resend.com/emails/inbound?limit=100&after=${rows[rows.length - 1].id}`
    }
  } catch { /* best-effort */ }
  return idx
}

async function fetchResendBody(id: string): Promise<string | null> {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  try {
    const r = await fetch(`https://api.resend.com/emails/inbound/${id}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { text?: string; html?: string }
    const raw = d.text || (d.html ? d.html.replace(/<[^>]+>/g, ' ') : '')
    return raw ? raw.replace(/\s+/g, ' ').trim() : null
  } catch {
    return null
  }
}

const RELAY = new Set([
  'greenhouse-mail', 'greenhouse', 'lever', 'myworkday', 'workday', 'ashbyhq',
  'ashby', 'smartrecruiters', 'icims', 'jobvite', 'gmail', 'googlemail',
  'outlook', 'hotmail', 'yahoo', 'resend', 'amazonses', 'sendgrid',
])

async function matchByCompany(
  userId: string,
  fromEmail: string,
  fromName: string | null,
): Promise<string | null> {
  const labels = (fromEmail.split('@')[1] || '').toLowerCase().split('.').filter(Boolean)
  const sld = labels.length >= 2 ? labels[labels.length - 2] : ''
  const candidates = [sld, fromName?.toLowerCase() ?? '']
    .map((c) => c.trim())
    .filter((c) => c.length >= 3 && !RELAY.has(c))
  for (const token of candidates) {
    const app = await prisma.jobApplication.findFirst({
      where: { userId, company: { contains: token, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (app) return app.id
  }
  return null
}
