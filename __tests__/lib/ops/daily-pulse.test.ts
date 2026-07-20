/**
 * Tests for the daily-pulse Sydney-window math (the tricky part) and the
 * 9am-Sydney send gate. Prisma/alerts mocked.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    analyticsEvent: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    rescueOrder: { count: jest.fn() },
    user: { count: jest.fn(), findMany: jest.fn() },
    jobApplication: { groupBy: jest.fn(), findMany: jest.fn() },
  },
}))
jest.mock('@/lib/alerts', () => ({ sendAdminMessage: jest.fn().mockResolvedValue(true) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: jest.fn().mockResolvedValue(undefined) }))
jest.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn, revalidateTag: jest.fn() }))
jest.mock('@/lib/pricing', () => ({ getPlanByPriceId: () => ({ price: 19, intervalKey: 'month' }) }))

import { sendAdminMessage } from '@/lib/alerts'
import { currentSydneyHour, maybeSendDailyPulse, sydneyYesterdayWindow } from '@/lib/ops/daily-pulse'
import { prisma } from '@/lib/prisma'

const p = prisma as unknown as {
  analyticsEvent: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock }
  rescueOrder: { count: jest.Mock }
  user: { count: jest.Mock; findMany: jest.Mock }
  jobApplication: { groupBy: jest.Mock; findMany: jest.Mock }
}

describe('sydneyYesterdayWindow', () => {
  it('is exactly a 24h window', () => {
    const { start, end } = sydneyYesterdayWindow(new Date('2026-07-20T00:00:00Z'))
    expect(end.getTime() - start.getTime()).toBe(24 * 3600_000)
  })

  it('end is a Sydney midnight (00:00 Sydney wall-clock)', () => {
    const { end } = sydneyYesterdayWindow(new Date('2026-07-20T05:30:00Z'))
    const sydHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false,
    }).format(end)
    expect(parseInt(sydHour, 10) % 24).toBe(0)
  })

  it('window ends at or before now', () => {
    const now = new Date('2026-07-20T05:30:00Z')
    const { end } = sydneyYesterdayWindow(now)
    expect(end.getTime()).toBeLessThanOrEqual(now.getTime())
  })
})

describe('currentSydneyHour', () => {
  it('July: Sydney is UTC+10, so 23:00 UTC is 09:00 Sydney', () => {
    expect(currentSydneyHour(new Date('2026-07-20T23:00:00Z'))).toBe(9)
  })
})

describe('maybeSendDailyPulse gate', () => {
  beforeEach(() => jest.clearAllMocks())

  it('skips when not 9am Sydney', async () => {
    // 12:00 UTC = 22:00 Sydney (July)
    const r = await maybeSendDailyPulse(new Date('2026-07-20T12:00:00Z'))
    expect(r).toBe('skipped')
    expect(p.analyticsEvent.findFirst).not.toHaveBeenCalled()
    expect(sendAdminMessage).not.toHaveBeenCalled()
  })

  it('skips when already sent today', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue({ id: 'x' })
    const r = await maybeSendDailyPulse(new Date('2026-07-20T23:00:00Z')) // 9am Sydney
    expect(r).toBe('skipped')
    expect(sendAdminMessage).not.toHaveBeenCalled()
  })

  it('sends at 9am Sydney when not yet sent', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue(null)
    p.analyticsEvent.findMany.mockResolvedValue([
      { sessionId: 'a', page: '/resume-rescue', referrer: 'https://google.com' },
      { sessionId: 'b', page: '/resume-rescue', referrer: 'https://google.com' },
    ])
    p.analyticsEvent.count.mockResolvedValue(1)
    p.rescueOrder.count.mockResolvedValue(1)
    p.user.count.mockResolvedValue(2)
    p.user.findMany.mockResolvedValue([]) // getRevenueMetrics: active subs, churn
    p.jobApplication.groupBy.mockResolvedValue([{ status: 'SUBMITTED', _count: { _all: 3 } }])
    p.jobApplication.findMany.mockResolvedValue([])

    const r = await maybeSendDailyPulse(new Date('2026-07-20T23:00:00Z'))
    expect(r).toBe('sent')
    expect(sendAdminMessage).toHaveBeenCalledTimes(1)
    const [text, opts] = (sendAdminMessage as jest.Mock).mock.calls[0]
    expect(text).toContain('Visitors        2 unique')
    expect(text).toContain('Tripwire sales  1')
    expect(opts.title).toBe('ResumeAI daily pulse')
  })
})
