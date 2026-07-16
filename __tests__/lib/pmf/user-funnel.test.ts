/**
 * Unit tests for the acquisition funnel (lib/pmf/user-funnel.ts) and the
 * weekly-snapshot send gate (lib/pmf/weekly-snapshot.ts). Prisma and email
 * are mocked; we test the counting arithmetic and the Monday/dedup gating
 * that runs inside the production daily-digest cron.
 */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: jest.fn(), findMany: jest.fn() },
    resume: { groupBy: jest.fn() },
    jobApplication: { groupBy: jest.fn() },
    analyticsEvent: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  },
}))

jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}))

jest.mock('@/lib/analytics-advanced', () => ({
  trackEvent: jest.fn().mockResolvedValue(undefined),
}))

// unstable_cache passthrough (weekly-snapshot pulls getRevenueMetrics)
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: jest.fn(),
}))

jest.mock('@/lib/pricing', () => ({
  getPlanByPriceId: () => ({ price: 19.99, intervalKey: 'month' }),
}))

import { sendEmail } from '@/lib/email'
import { getUserFunnel, getWeek2Retention } from '@/lib/pmf/user-funnel'
import { maybeSendWeeklySnapshot } from '@/lib/pmf/weekly-snapshot'
import { prisma } from '@/lib/prisma'

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
  user: { count: jest.Mock; findMany: jest.Mock }
  resume: { groupBy: jest.Mock }
  jobApplication: { groupBy: jest.Mock }
  analyticsEvent: { findMany: jest.Mock; findFirst: jest.Mock }
}

afterEach(() => jest.clearAllMocks())

describe('getUserFunnel', () => {
  it('counts steps and computes conversions', async () => {
    const inWindow = new Date()
    mockPrisma.analyticsEvent.findMany.mockResolvedValue([
      { sessionId: 'v1' },
      { sessionId: 'v2' },
      { sessionId: 'v3' },
      { sessionId: 'v4' },
    ])
    mockPrisma.user.count
      .mockResolvedValueOnce(2) // signups
      .mockResolvedValueOnce(1) // subscribed
    mockPrisma.resume.groupBy.mockResolvedValue([
      { userId: 'u1', _min: { createdAt: inWindow } },
      { userId: 'u2', _min: { createdAt: new Date('2020-01-01') } }, // before window
    ])
    mockPrisma.jobApplication.groupBy.mockResolvedValue([
      { userId: 'u1', _min: { createdAt: inWindow } },
    ])

    const f = await getUserFunnel(new Date(Date.now() - 7 * 86_400_000))
    expect(f.landing_view).toBe(4)
    expect(f.signup).toBe(2)
    expect(f.onboarding_complete).toBe(1) // only the first-resume-in-window user
    expect(f.first_application).toBe(1)
    expect(f.subscribed).toBe(1)
    expect(f.conversion.visitToSignup).toBeCloseTo(0.5)
    expect(f.conversion.signupToActivated).toBeCloseTo(0.5)
  })

  it('returns null conversions on empty upstream steps', async () => {
    mockPrisma.analyticsEvent.findMany.mockResolvedValue([])
    mockPrisma.user.count.mockResolvedValue(0)
    mockPrisma.resume.groupBy.mockResolvedValue([])
    mockPrisma.jobApplication.groupBy.mockResolvedValue([])

    const f = await getUserFunnel()
    expect(f.conversion.visitToSignup).toBeNull()
    expect(f.conversion.signupToActivated).toBeNull()
  })
})

describe('getWeek2Retention', () => {
  it('retains only users active in their day 7-14 window', async () => {
    const signup = new Date(Date.now() - 20 * 86_400_000)
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'kept', createdAt: signup },
      { id: 'gone', createdAt: signup },
    ])
    mockPrisma.analyticsEvent.findMany.mockResolvedValue([
      // 'kept': event 8 days after signup — inside the window
      { userId: 'kept', createdAt: new Date(signup.getTime() + 8 * 86_400_000) },
      // 'gone': event 2 days after signup — before the window
      { userId: 'gone', createdAt: new Date(signup.getTime() + 2 * 86_400_000) },
    ])

    const r = await getWeek2Retention()
    expect(r.cohortSize).toBe(2)
    expect(r.retained).toBe(1)
    expect(r.rate).toBeCloseTo(0.5)
  })

  it('handles an empty cohort', async () => {
    mockPrisma.user.findMany.mockResolvedValue([])
    const r = await getWeek2Retention()
    expect(r).toEqual({ cohortSize: 0, retained: 0, rate: null })
  })
})

describe('maybeSendWeeklySnapshot gating', () => {
  it('skips outside Monday 09-12 UTC without touching the DB', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T10:00:00Z')) // Wednesday
    const result = await maybeSendWeeklySnapshot()
    expect(result).toBe('skipped')
    expect(mockPrisma.analyticsEvent.findFirst).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('skips when already sent this week (dedup marker)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T10:00:00Z')) // Monday
    process.env.ADMIN_EMAILS = 'founder@example.com'
    mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ id: 'evt1' })
    const result = await maybeSendWeeklySnapshot()
    expect(result).toBe('skipped')
    expect(sendEmail).not.toHaveBeenCalled()
    jest.useRealTimers()
    delete process.env.ADMIN_EMAILS
  })

  it('skips when ADMIN_EMAILS is unset', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T10:00:00Z')) // Monday
    delete process.env.ADMIN_EMAILS
    const result = await maybeSendWeeklySnapshot()
    expect(result).toBe('skipped')
    expect(sendEmail).not.toHaveBeenCalled()
    jest.useRealTimers()
  })
})
