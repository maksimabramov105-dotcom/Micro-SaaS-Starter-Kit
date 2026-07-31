/**
 * Weekly user digest (P3.4).
 *
 * Two things can go wrong with a recurring email and both are unrecoverable
 * reputation damage: sending it twice, or sending it to someone with nothing to
 * report. The gating tests below are the ones that matter; the fit-tip tests
 * cover the part that is actually novel.
 */
const mockSendEmail = jest.fn()
const mockTrack = jest.fn()
const mockIsSuppressed = jest.fn()
const mockPrisma = {
  user: { findMany: jest.fn() },
  analyticsEvent: { findMany: jest.fn() },
  jobApplication: { groupBy: jest.fn(), findMany: jest.fn() },
  inboxMessage: { count: jest.fn() },
}

// Getter form: jest hoists this factory above the const declarations.
jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: (...a: unknown[]) => mockTrack(...a) }))
jest.mock('@/lib/nurture', () => ({ isSuppressed: (...a: unknown[]) => mockIsSuppressed(...a) }))

import { maybeSendWeeklyDigests, weakestFactor } from '@/lib/lifecycle/weekly'

// 2026-08-03 is a Monday.
const MONDAY_10Z = new Date('2026-08-03T10:00:00Z')
const MONDAY_03Z = new Date('2026-08-03T03:00:00Z')
const TUESDAY_10Z = new Date('2026-08-04T10:00:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  mockSendEmail.mockResolvedValue({ success: true })
  mockTrack.mockResolvedValue(undefined)
  mockIsSuppressed.mockResolvedValue(false)
  mockPrisma.jobApplication.groupBy.mockResolvedValue([{ userId: 'u1', _count: { _all: 3 } }])
  mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada L', email: 'a@b.c' }])
  mockPrisma.analyticsEvent.findMany.mockResolvedValue([])
  mockPrisma.jobApplication.findMany.mockResolvedValue([
    { status: 'SUBMITTED', fitBreakdown: { skills: 20, seniority: 24, eligibility: 14, language: 9 } },
    { status: 'DRAFT', fitBreakdown: { skills: 18, seniority: 23, eligibility: 15, language: 10 } },
  ])
  mockPrisma.inboxMessage.count.mockResolvedValue(0)
})

describe('scheduling gate', () => {
  it('sends on Monday morning UTC', async () => {
    expect(await maybeSendWeeklyDigests(MONDAY_10Z)).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('does not send on other days', async () => {
    expect(await maybeSendWeeklyDigests(TUESDAY_10Z)).toBe(0)
    // and does not even hit the database
    expect(mockPrisma.jobApplication.groupBy).not.toHaveBeenCalled()
  })

  it('does not send in the middle of the night', async () => {
    expect(await maybeSendWeeklyDigests(MONDAY_03Z)).toBe(0)
  })

  it('never sends twice in the same ISO week', async () => {
    mockPrisma.analyticsEvent.findMany.mockResolvedValue([{ userId: 'u1' }])
    expect(await maybeSendWeeklyDigests(MONDAY_10Z)).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('queries the marker scoped to this ISO week, not all time', async () => {
    await maybeSendWeeklyDigests(MONDAY_10Z)
    expect(mockPrisma.analyticsEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          properties: { path: ['week'], equals: '2026-W32' },
        }),
      }),
    )
  })
})

describe('who gets it', () => {
  it('sends nothing when nobody was active', async () => {
    mockPrisma.jobApplication.groupBy.mockResolvedValue([])
    expect(await maybeSendWeeklyDigests(MONDAY_10Z)).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('respects the shared suppression list', async () => {
    mockIsSuppressed.mockResolvedValue(true)
    expect(await maybeSendWeeklyDigests(MONDAY_10Z)).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not record the marker when the send failed', async () => {
    mockSendEmail.mockResolvedValue({ success: false })
    expect(await maybeSendWeeklyDigests(MONDAY_10Z)).toBe(0)
    expect(mockTrack).not.toHaveBeenCalled()
  })
})

describe('content', () => {
  it('counts only ATS-confirmed statuses as submitted', async () => {
    await maybeSendWeeklyDigests(MONDAY_10Z)
    const { subject, html } = mockSendEmail.mock.calls[0][0]
    expect(subject).toContain('2 applications')
    // one SUBMITTED, one DRAFT
    expect(html).toContain('Confirmed submitted:  1')
  })

  it('includes the fit tip for the weakest factor', async () => {
    await maybeSendWeeklyDigests(MONDAY_10Z)
    // skills averages 19/50 = 0.38, far below the other factors
    expect(mockSendEmail.mock.calls[0][0].html).toContain('skills overlap')
  })

  it('says nothing stands out when every factor is strong', async () => {
    mockPrisma.jobApplication.findMany.mockResolvedValue([
      { status: 'SUBMITTED', fitBreakdown: { skills: 48, seniority: 24, eligibility: 15, language: 10 } },
    ])
    await maybeSendWeeklyDigests(MONDAY_10Z)
    const { html } = mockSendEmail.mock.calls[0][0]
    expect(html).toContain('Nothing stands out')
    expect(html).not.toContain('skills overlap')
  })

  it('carries an unsubscribe link', async () => {
    await maybeSendWeeklyDigests(MONDAY_10Z)
    expect(mockSendEmail.mock.calls[0][0].html).toContain('/api/nurture/unsubscribe')
  })
})

describe('weakestFactor', () => {
  it('returns null with no breakdowns at all', () => {
    expect(weakestFactor([null, undefined, {}])).toBeNull()
  })

  it('normalises by each factor’s maximum rather than comparing raw points', () => {
    // 30/50 skills = 0.60; 20/25 seniority = 0.80. Raw points would wrongly
    // pick seniority as the weaker of the two.
    expect(weakestFactor([{ skills: 30, seniority: 20 }])).toBe('skills')
  })

  it('ignores factors that are not part of the scorer', () => {
    expect(weakestFactor([{ vibes: 0, skills: 45 }])).toBeNull()
  })

  it('returns null when nothing is genuinely weak', () => {
    expect(weakestFactor([{ skills: 45, seniority: 22 }])).toBeNull()
  })

  it('averages across the week rather than trusting one bad application', () => {
    const b = [
      { skills: 5 },
      { skills: 48 },
      { skills: 47 },
      { skills: 46 },
    ]
    // mean 36.5/50 = 0.73 -> still flagged, but only just; one outlier alone
    // must not dominate, so drop the outlier and it clears the threshold.
    expect(weakestFactor(b)).toBe('skills')
    expect(weakestFactor(b.slice(1))).toBeNull()
  })
})
