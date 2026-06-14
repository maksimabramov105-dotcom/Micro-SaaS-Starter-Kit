/**
 * Unit tests for PMF cohort-retention query logic.
 * Prisma is mocked; we test the percentage arithmetic and edge cases.
 */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    jobApplication: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    survey: {
      count: jest.fn(),
    },
  },
}))

// Deterministic plan prices (env price IDs are undefined in tests).
jest.mock('@/lib/pricing', () => ({
  getPlanByPriceId: (id: string | null | undefined) =>
    id === 'price_pro'
      ? { price: 19.99, intervalKey: 'month' }
      : id === 'price_annual'
        ? { price: 199, intervalKey: 'year' }
        : { price: 0, intervalKey: null },
}))

// unstable_cache passthrough — run functions directly in tests
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: jest.fn(),
}))

import { getCohortRetention, getLast30DaysMetrics, getRevenueMetrics, getWeeklyTrends } from '@/lib/pmf/queries'
import { prisma } from '@/lib/prisma'

const mockPrisma = prisma as unknown as {
  user: {
    count: jest.Mock
    findMany: jest.Mock
    groupBy: jest.Mock
  }
  jobApplication: { count: jest.Mock; findMany: jest.Mock }
  survey: { count: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

// ── getCohortRetention ─────────────────────────────────────────────────────

describe('getCohortRetention', () => {
  it('returns correct retention % when cohort exists', async () => {
    // D30 cohort: 10 users joined, 8 still subscribed → 80%
    // D60 cohort: 5 users joined, 3 still subscribed → 60%
    // D90 cohort: 4 users joined, 1 still subscribed → 25%
    let callIndex = 0
    mockPrisma.user.count.mockImplementation(() => {
      // called in pairs: cohortSize, stillSubscribed for each of [30, 60, 90]
      const values = [10, 8, 5, 3, 4, 1]
      return Promise.resolve(values[callIndex++])
    })

    const result = await getCohortRetention()

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ days: 30, cohortSize: 10, stillSubscribed: 8, retentionRate: 80 })
    expect(result[1]).toMatchObject({ days: 60, cohortSize: 5,  stillSubscribed: 3, retentionRate: 60 })
    expect(result[2]).toMatchObject({ days: 90, cohortSize: 4,  stillSubscribed: 1, retentionRate: 25 })
  })

  it('returns null retentionRate when cohort is empty (no data yet)', async () => {
    mockPrisma.user.count.mockResolvedValue(0)

    const result = await getCohortRetention()

    for (const row of result) {
      expect(row.cohortSize).toBe(0)
      expect(row.retentionRate).toBeNull()
    }
  })

  it('rounds retention % correctly', async () => {
    // 1 of 3 → 33.33% → rounds to 33
    let callIndex = 0
    mockPrisma.user.count.mockImplementation(() => {
      const values = [3, 1, 0, 0, 0, 0]
      return Promise.resolve(values[callIndex++])
    })

    const result = await getCohortRetention()
    expect(result[0].retentionRate).toBe(33)
  })

  it('handles 100% retention', async () => {
    let callIndex = 0
    mockPrisma.user.count.mockImplementation(() => {
      const values = [5, 5, 0, 0, 0, 0]
      return Promise.resolve(values[callIndex++])
    })

    const result = await getCohortRetention()
    expect(result[0].retentionRate).toBe(100)
  })
})

// ── getLast30DaysMetrics ───────────────────────────────────────────────────

describe('getLast30DaysMetrics', () => {
  function setupMocks({
    appsTotal = 0,
    appsSubmitted = 0,
    appsInterview = 0,
    appsOffer = 0,
    surveyYes = 0,
    surveyTotal = 0,
    cancellations = 0,
    totalPaidUsers = 0,
  } = {}) {
    const counts = [appsTotal, appsSubmitted, appsInterview, appsOffer,
                    surveyYes, surveyTotal, cancellations, totalPaidUsers]
    let i = 0
    mockPrisma.jobApplication.count.mockImplementation(() => {
      if (i < 4) return Promise.resolve(counts[i++])
      return Promise.resolve(0)
    })
    mockPrisma.survey.count.mockImplementation(() => {
      if (i >= 4 && i < 6) return Promise.resolve(counts[i++])
      return Promise.resolve(0)
    })
    mockPrisma.user.count.mockImplementation(() => {
      if (i >= 6 && i < 8) return Promise.resolve(counts[i++])
      return Promise.resolve(0)
    })
  }

  it('calculates submission success rate', async () => {
    mockPrisma.jobApplication.count
      .mockResolvedValueOnce(100) // appsTotal
      .mockResolvedValueOnce(80)  // appsSubmitted
      .mockResolvedValueOnce(10)  // appsInterview
      .mockResolvedValueOnce(2)   // appsOffer
    mockPrisma.survey.count.mockResolvedValue(0)
    mockPrisma.user.count.mockResolvedValue(0)

    const result = await getLast30DaysMetrics()

    expect(result.appsTotal).toBe(100)
    expect(result.appsSubmitted).toBe(80)
    expect(result.submissionSuccessRate).toBe(80)
  })

  it('returns null rates when denominators are zero', async () => {
    mockPrisma.jobApplication.count.mockResolvedValue(0)
    mockPrisma.survey.count.mockResolvedValue(0)
    mockPrisma.user.count.mockResolvedValue(0)

    const result = await getLast30DaysMetrics()

    expect(result.submissionSuccessRate).toBeNull()
    expect(result.interviewRateSurvey).toBeNull()
    expect(result.interviewRateApps).toBeNull()
    expect(result.refundRate).toBeNull()
  })

  it('computes survey-based interview rate', async () => {
    mockPrisma.jobApplication.count
      .mockResolvedValueOnce(200) // total
      .mockResolvedValueOnce(180) // submitted
      .mockResolvedValueOnce(0)   // interview
      .mockResolvedValueOnce(0)   // offer
    mockPrisma.survey.count
      .mockResolvedValueOnce(3)   // surveyYes
      .mockResolvedValueOnce(10)  // surveyTotal
    mockPrisma.user.count.mockResolvedValue(0)

    const result = await getLast30DaysMetrics()
    expect(result.interviewRateSurvey).toBe(30) // 3/10 = 30%
  })
})

// ── getRevenueMetrics ──────────────────────────────────────────────────────

describe('getRevenueMetrics', () => {
  it('computes MRR / ARR / ARPU and normalizes annual plans to monthly', async () => {
    mockPrisma.user.findMany
      // active subs: 2 monthly Pro + 1 annual Pro
      .mockResolvedValueOnce([
        { stripePriceId: 'price_pro' },
        { stripePriceId: 'price_pro' },
        { stripePriceId: 'price_annual' },
      ])
      // churned in last 30d: 1 monthly Pro
      .mockResolvedValueOnce([{ stripePriceId: 'price_pro' }])
    mockPrisma.user.count
      .mockResolvedValueOnce(5)  // payingEver
      .mockResolvedValueOnce(50) // totalUsers

    const r = await getRevenueMetrics()
    // 2 * 1999 + round(19900/12)=1658  => 5656 cents
    expect(r.mrrCents).toBe(1999 + 1999 + 1658)
    expect(r.arrCents).toBe(r.mrrCents * 12)
    expect(r.payingCustomers).toBe(3)
    expect(r.arpuCents).toBe(Math.round(r.mrrCents / 3))
    expect(r.churnedMrrCents).toBe(1999)
    expect(r.freeToPaidRate).toBe(10) // 5 / 50
  })

  it('handles zero paying customers without dividing by zero', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockPrisma.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)

    const r = await getRevenueMetrics()
    expect(r.mrrCents).toBe(0)
    expect(r.arpuCents).toBe(0)
    expect(r.freeToPaidRate).toBeNull()
  })
})

// ── getWeeklyTrends ────────────────────────────────────────────────────────

describe('getWeeklyTrends', () => {
  it('buckets this week\'s events into the latest of 8 week buckets', async () => {
    const now = new Date()
    mockPrisma.user.findMany
      .mockResolvedValueOnce([{ createdAt: now }, { createdAt: now }]) // signups
      .mockResolvedValueOnce([{ firstPaidAt: now, stripePriceId: 'price_pro' }]) // conversions
      .mockResolvedValueOnce([]) // churn
    mockPrisma.jobApplication.findMany
      .mockResolvedValueOnce([{ appliedAt: now }, { appliedAt: now }, { appliedAt: now }]) // submitted
      .mockResolvedValueOnce([{ responseAt: now }]) // interviews

    const weeks = await getWeeklyTrends()
    expect(weeks).toHaveLength(8)
    const latest = weeks[weeks.length - 1]
    expect(latest.signups).toBe(2)
    expect(latest.conversions).toBe(1)
    expect(latest.submitted).toBe(3)
    expect(latest.interviews).toBe(1)
    expect(latest.netNewMrrCents).toBe(1999)
    // The series has no gaps (every week present, oldest → newest).
    expect(weeks[0].signups).toBe(0)
  })
})
