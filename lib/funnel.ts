/**
 * lib/funnel.ts — application-funnel telemetry.
 *
 * Records where applications are in the pipeline so we can measure the metric
 * that actually matters for this product: interview-rate per campaign, and the
 * drop-off at each stage. Without this we cannot see whether applications die
 * at sourcing, eligibility, the apply step, or in silence after sending.
 *
 * Stages (in order):
 *   sourced        — a job was scraped and considered for a campaign
 *   eligible       — it passed the eligibility + job-fit gates (would be applied)
 *   applied        — an application was actually submitted to the ATS
 *   reply_received — a human reply (interview / rejection / question) came back
 *   interview      — the reply was an interview request
 *
 * Events are written to the existing AnalyticsEvent table (single-VPS: no extra
 * datastore). Telemetry is strictly best-effort and never blocks the caller.
 */
import { trackEvent } from '@/lib/analytics-advanced'
import { prisma } from '@/lib/prisma'

export type FunnelStage = 'sourced' | 'eligible' | 'applied' | 'reply_received' | 'interview'

export async function recordFunnel(
  stage: FunnelStage,
  params: {
    userId?: string
    campaignId?: string | null
    count?: number
    applicationId?: string | null
    source?: string | null
  },
): Promise<void> {
  try {
    await trackEvent({
      event: `funnel_${stage}`,
      userId: params.userId,
      properties: {
        stage,
        campaignId: params.campaignId ?? null,
        applicationId: params.applicationId ?? null,
        source: params.source ?? null,
        count: params.count ?? 1,
      },
    })
  } catch {
    // best-effort: a telemetry failure must never break sourcing/applying/inbox
  }
}

export interface FunnelTotals {
  sourced: number
  eligible: number
  applied: number
  reply_received: number
  interview: number
  /** interview ÷ applied, 0..1 (null when nothing applied yet). */
  interviewRate: number | null
}

const STAGES: FunnelStage[] = ['sourced', 'eligible', 'applied', 'reply_received', 'interview']

/**
 * Aggregate funnel totals over a time window, optionally for one campaign.
 * Sums the `count` property across each stage's events. Used by the metrics
 * dashboard to show signup → applied → reply → interview.
 */
export async function getFunnelTotals(opts?: {
  campaignId?: string
  since?: Date
}): Promise<FunnelTotals> {
  const since = opts?.since ?? new Date(Date.now() - 30 * 86_400_000)
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      event: { in: STAGES.map((s) => `funnel_${s}`) },
      createdAt: { gte: since },
    },
    select: { event: true, properties: true },
  })

  const totals: Record<FunnelStage, number> = {
    sourced: 0, eligible: 0, applied: 0, reply_received: 0, interview: 0,
  }
  for (const r of rows) {
    const props = (r.properties ?? {}) as { stage?: string; campaignId?: string | null; count?: number }
    if (opts?.campaignId && props.campaignId !== opts.campaignId) continue
    const stage = (props.stage ?? r.event.replace(/^funnel_/, '')) as FunnelStage
    if (stage in totals) totals[stage] += typeof props.count === 'number' ? props.count : 1
  }

  return {
    ...totals,
    interviewRate: totals.applied > 0 ? totals.interview / totals.applied : null,
  }
}
