/**
 * lib/blog/stats.ts — blog-shaped view of the verified-pipeline telemetry (B3).
 *
 * The NUMBERS come from lib/stats/verified.ts (the single source shared with
 * /proof — see E1); this module only adds the blog-specific presentation:
 * bucketing raw failure messages into human-readable modes.
 */
import { getVerifiedStatsSafe, type VerifiedStats } from '@/lib/stats/verified'

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

function toBlogShape(s: VerifiedStats): VerificationStats {
  const buckets = new Map<string, number>()
  for (const msg of s.failureMessages) {
    const bucket = bucketFailure(msg)
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  }
  const topFailureModes = [...buckets.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return {
    attempted: s.attempted,
    sent: s.submitted,
    confirmed: s.confirmed,
    confirmedPct: s.confirmedPct,
    replies: s.replies,
    humanReplies: s.humanReplies,
    replyPct: s.replyPct,
    failed: s.failed,
    failedPct: s.failedPct,
    topFailureModes,
    generatedAt: s.generatedAt,
  }
}

/** Never throws: a DB hiccup must not 500 a marketing page. Null = unavailable. */
export async function getVerificationStatsSafe(): Promise<VerificationStats | null> {
  const stats = await getVerifiedStatsSafe()
  return stats === null ? null : toBlogShape(stats)
}
