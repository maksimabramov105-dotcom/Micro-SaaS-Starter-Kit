/**
 * lib/blog/stats.ts — live telemetry for the data-driven blog posts (B3).
 *
 * Aggregate, anonymized numbers straight from our own pipeline tables. The
 * posts render these at request time under daily ISR, so the content stays
 * current automatically — no manual refresh, no cron, and nobody can copy
 * the dataset because it is ours.
 */
import { prisma } from '@/lib/prisma'

const SENT_STATUSES = ['SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED'] as const

export interface VerificationStats {
  attempted: number
  sent: number
  confirmed: number
  confirmedPct: number | null
  replies: number
  humanReplies: number
  replyPct: number | null
  failed: number
  failedPct: number | null
  topFailureModes: { reason: string; count: number }[]
  generatedAt: string
}

/** Bucket raw error messages into human-readable failure modes. */
function bucketFailure(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('captcha') || m.includes('cloudflare') || m.includes('challenge'))
    return 'Bot walls (CAPTCHA / challenge pages)'
  if (m.includes('timeout') || m.includes('timed out')) return 'Form timeouts'
  if (m.includes('404') || m.includes('not found') || m.includes('closed') || m.includes('expired'))
    return 'Stale or closed postings'
  if (m.includes('field') || m.includes('required') || m.includes('validation') || m.includes('missing'))
    return 'Unexpected required fields'
  if (m.includes('login') || m.includes('auth') || m.includes('sign'))
    return 'Login-walled applications'
  if (m.includes('file') || m.includes('upload') || m.includes('resume') || m.includes('pdf'))
    return 'Resume upload rejections'
  return 'Other automation failures'
}

/** Never throws: a DB hiccup must not 500 a marketing page. Null = unavailable. */
export async function getVerificationStatsSafe(): Promise<VerificationStats | null> {
  try {
    return await getVerificationStats()
  } catch (err) {
    console.warn('[blog] stats unavailable:', err)
    return null
  }
}

export async function getVerificationStats(): Promise<VerificationStats> {
  const [attempted, sent, confirmed, replies, humanReplies, failedRows] = await Promise.all([
    prisma.jobApplication.count(),
    prisma.jobApplication.count({ where: { status: { in: [...SENT_STATUSES] } } }),
    prisma.applicationEvent.count({ where: { type: 'confirmed' } }),
    prisma.inboxMessage.count(),
    prisma.inboxMessage.count({
      where: { classification: { in: ['INTERVIEW_REQUEST', 'QUESTION', 'REJECTION'] } },
    }),
    prisma.jobApplication.findMany({
      where: { status: 'FAILED', errorMessage: { not: null } },
      select: { errorMessage: true },
    }),
  ])

  const buckets = new Map<string, number>()
  for (const row of failedRows) {
    const bucket = bucketFailure(row.errorMessage ?? '')
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  }
  const topFailureModes = [...buckets.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  const failed = failedRows.length
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null)

  return {
    attempted,
    sent,
    confirmed,
    confirmedPct: pct(confirmed, sent),
    replies,
    humanReplies,
    replyPct: pct(humanReplies, sent),
    failed,
    failedPct: pct(failed, attempted),
    topFailureModes,
    generatedAt: new Date().toISOString().slice(0, 10),
  }
}
