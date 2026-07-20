/**
 * lib/stats/verified.ts — THE single source of verified-pipeline stats (E1).
 *
 * Before this module /proof and the blog each ran their own counts, so the
 * same "applications submitted" number could differ between pages. Every
 * surface that shows a verified-pipeline number now imports from here.
 *
 * Definitions (exact — copy must match):
 *   submitted  our system completed the application (JobApplication in SENT_STATUSES)
 *   confirmed  the employer's ATS acknowledged receipt (ApplicationEvent 'confirmed')
 *   replies    messages captured in the inbox; humanReplies excludes AUTOMATED/OTHER
 *   failed     attempts that never reached submission (status FAILED)
 */
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

export const SENT_STATUSES = ['SUBMITTED', 'INTERVIEW', 'REJECTED', 'OFFER'] as const

export interface VerifiedStats {
  submitted: number
  confirmed: number
  confirmedPct: number | null
  replies: number
  humanReplies: number
  interviews: number
  replyPct: number | null
  failed: number
  failedPct: number | null
  attempted: number
  medianReplyDays: number | null
  /** Raw FAILED errorMessages, for callers that bucket them (blog). */
  failureMessages: string[]
  generatedAt: string
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 100) : null
}

/** Cached 1h — every consumer shares the same numbers within the window. */
export const getVerifiedStats = unstable_cache(
  async (): Promise<VerifiedStats> => {
    const [attempted, submitted, confirmed, replyGroups, replied, failedRows] = await Promise.all([
      prisma.jobApplication.count(),
      prisma.jobApplication.count({ where: { status: { in: [...SENT_STATUSES] } } }),
      prisma.applicationEvent.count({ where: { type: 'confirmed' } }),
      prisma.inboxMessage.groupBy({ by: ['classification'], _count: { _all: true } }),
      prisma.jobApplication.findMany({
        where: { appliedAt: { not: null }, responseAt: { not: null } },
        select: { appliedAt: true, responseAt: true },
      }),
      prisma.jobApplication.findMany({
        where: { status: 'FAILED', errorMessage: { not: null } },
        select: { errorMessage: true },
      }),
    ])

    const c = (k: string) => replyGroups.find((g) => g.classification === k)?._count._all ?? 0
    const humanReplies = c('INTERVIEW_REQUEST') + c('REJECTION') + c('QUESTION')
    const replies = replyGroups.reduce((s, g) => s + g._count._all, 0)
    const days = replied
      .map((a) => (a.responseAt!.getTime() - a.appliedAt!.getTime()) / 86_400_000)
      .filter((d) => d >= 0)

    return {
      attempted,
      submitted,
      confirmed,
      confirmedPct: pct(confirmed, submitted),
      replies,
      humanReplies,
      interviews: c('INTERVIEW_REQUEST'),
      replyPct: pct(humanReplies, submitted),
      failed: failedRows.length,
      failedPct: pct(failedRows.length, attempted),
      medianReplyDays: median(days),
      failureMessages: failedRows.map((f) => f.errorMessage ?? ''),
      generatedAt: new Date().toISOString().slice(0, 10),
    }
  },
  ['verified-stats-v1'],
  { revalidate: 3600 },
)

/** Never throws — marketing pages degrade instead of 500ing. */
export async function getVerifiedStatsSafe(): Promise<VerifiedStats | null> {
  try {
    return await getVerifiedStats()
  } catch (err) {
    console.warn('[stats] verified stats unavailable:', err)
    return null
  }
}
