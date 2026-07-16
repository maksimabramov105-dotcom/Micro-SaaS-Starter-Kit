/**
 * lib/pmf/user-funnel.ts — the ACQUISITION funnel (P0.2 of docs/MASTER_PLAN.md).
 *
 * This is the funnel the pivot's goals are measured against:
 *
 *   landing_view -> signup -> onboarding_complete -> first_application -> subscribed
 *
 * It is distinct from lib/funnel.ts, which tracks the per-application PIPELINE
 * (sourced -> eligible -> applied -> reply -> interview). This one tracks
 * PEOPLE: how many visitors become activated users (G1) and payers (G2/G3).
 *
 * Step definitions (single source of truth — dashboards and reports must use
 * these, not re-derive their own):
 *
 *   landing_view        unique visitors: distinct AnalyticsEvent.sessionId of
 *                       `page_view` events (sessionId = anonymous rai_vid id
 *                       from components/page-view-tracker.tsx)
 *   signup              User rows created in the window
 *   onboarding_complete users whose FIRST Resume was created in the window
 *                       (no formal onboarding flow yet; ">=1 resume" is the
 *                       working definition until Phase 4 builds one)
 *   first_application   users whose first ACTIVATING application happened in
 *                       the window — the G1 "activated" definition
 *   subscribed          users whose firstPaidAt falls in the window
 */
import { prisma } from '@/lib/prisma'
import { ApplicationStatus } from '@prisma/client'

/**
 * Statuses that mean an application genuinely went out (or was tracked as
 * genuinely sent by the user). QUEUED/FAILED/WITHDRAWN do not activate.
 * INTERVIEW/OFFER/REJECTED imply a past successful submission.
 */
export const ACTIVATION_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.REJECTED,
]

export type UserFunnelStep =
  | 'landing_view'
  | 'signup'
  | 'onboarding_complete'
  | 'first_application'
  | 'subscribed'

export const USER_FUNNEL_STEPS: { key: UserFunnelStep; label: string }[] = [
  { key: 'landing_view', label: 'Unique visitors' },
  { key: 'signup', label: 'Signed up' },
  { key: 'onboarding_complete', label: 'Onboarding complete (>=1 resume)' },
  { key: 'first_application', label: 'Activated (first real application)' },
  { key: 'subscribed', label: 'Subscribed (first payment)' },
]

export interface UserFunnelCounts {
  since: Date
  landing_view: number
  signup: number
  onboarding_complete: number
  first_application: number
  subscribed: number
  /** step-to-step conversion, 0..1, null when the upstream step is 0 */
  conversion: {
    visitToSignup: number | null
    signupToOnboarded: number | null
    onboardedToActivated: number | null
    activatedToPaid: number | null
    /** the headline number: signup -> activated (Phase 4 exit target >= 0.4) */
    signupToActivated: number | null
  }
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null
}

/**
 * Aggregate the user funnel since a date (default: last 30 days).
 *
 * "First X in window" is computed by grouping each user's earliest qualifying
 * row and counting those whose earliest falls inside the window — so a
 * long-time user tracking their 50th application doesn't count as a new
 * activation.
 */
export interface Week2Retention {
  /** users who signed up 14-28 days ago */
  cohortSize: number
  /** of those, users with any logged-in activity 7-14 days after their signup */
  retained: number
  /** retained / cohortSize, 0..1, null when the cohort is empty */
  rate: number | null
}

/**
 * Week-2 activity retention — the decision-gate metric from MASTER_PLAN.md.
 *
 * Cohort: users created 14-28 days ago (old enough for their day-7..14 window
 * to have fully elapsed). Retained: any AnalyticsEvent attributed to the user
 * (page_view fires on every route when logged in) between +7d and +14d after
 * signup.
 */
export async function getWeek2Retention(): Promise<Week2Retention> {
  const now = Date.now()
  const cohort = await prisma.user.findMany({
    where: {
      createdAt: { gte: new Date(now - 28 * 86_400_000), lt: new Date(now - 14 * 86_400_000) },
    },
    select: { id: true, createdAt: true },
  })
  if (cohort.length === 0) return { cohortSize: 0, retained: 0, rate: null }

  const events = await prisma.analyticsEvent.findMany({
    where: {
      userId: { in: cohort.map((u) => u.id) },
      createdAt: { gte: new Date(now - 28 * 86_400_000) },
    },
    select: { userId: true, createdAt: true },
  })
  const byUser = new Map<string, Date[]>()
  for (const e of events) {
    if (!e.userId) continue
    const arr = byUser.get(e.userId) ?? []
    arr.push(e.createdAt)
    byUser.set(e.userId, arr)
  }
  const retained = cohort.filter((u) => {
    const from = u.createdAt.getTime() + 7 * 86_400_000
    const to = u.createdAt.getTime() + 14 * 86_400_000
    return (byUser.get(u.id) ?? []).some((d) => d.getTime() >= from && d.getTime() < to)
  }).length

  return { cohortSize: cohort.length, retained, rate: ratio(retained, cohort.length) }
}

export async function getUserFunnel(since?: Date): Promise<UserFunnelCounts> {
  const start = since ?? new Date(Date.now() - 30 * 86_400_000)

  const [visitorRows, signups, firstResumes, firstApplications, subscribed] =
    await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { event: 'page_view', createdAt: { gte: start }, sessionId: { not: null } },
        distinct: ['sessionId'],
        select: { sessionId: true },
      }),
      prisma.user.count({ where: { createdAt: { gte: start } } }),
      prisma.resume.groupBy({
        by: ['userId'],
        _min: { createdAt: true },
      }),
      prisma.jobApplication.groupBy({
        by: ['userId'],
        where: { status: { in: ACTIVATION_STATUSES } },
        _min: { createdAt: true },
      }),
      prisma.user.count({ where: { firstPaidAt: { gte: start } } }),
    ])

  const landing_view = visitorRows.length
  const onboarding_complete = firstResumes.filter(
    (r) => r._min.createdAt && r._min.createdAt >= start,
  ).length
  const first_application = firstApplications.filter(
    (r) => r._min.createdAt && r._min.createdAt >= start,
  ).length

  return {
    since: start,
    landing_view,
    signup: signups,
    onboarding_complete,
    first_application,
    subscribed,
    conversion: {
      visitToSignup: ratio(signups, landing_view),
      signupToOnboarded: ratio(onboarding_complete, signups),
      onboardedToActivated: ratio(first_application, onboarding_complete),
      activatedToPaid: ratio(subscribed, first_application),
      signupToActivated: ratio(first_application, signups),
    },
  }
}
