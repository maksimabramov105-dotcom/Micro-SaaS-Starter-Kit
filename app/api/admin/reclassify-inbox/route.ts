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
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '300') || 300, 1000)

  const messages = await prisma.inboxMessage.findMany({
    where: { classification: { in: ['UNCLASSIFIED', 'OTHER'] } },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: {
      id: true, userId: true, applicationId: true,
      fromEmail: true, fromName: true, subject: true, bodyText: true,
    },
  })

  const counts: Record<string, number> = {}
  let statusUpdates = 0

  for (const m of messages) {
    const { classification } = await classifyEmail({
      fromEmail: m.fromEmail,
      subject: m.subject,
      bodyText: m.bodyText ?? '',
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

  return NextResponse.json({ ok: true, processed: messages.length, counts, statusUpdates })
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
