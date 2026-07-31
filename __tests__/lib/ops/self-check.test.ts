/**
 * Tests for the money-path self-check: pass/fail detection across the three
 * checks and that failures alert via P0.4. fetch + prisma + alerts mocked.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    analyticsEvent: { findFirst: jest.fn() },
    inboxMessage: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/alerts', () => ({ sendAdminAlert: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: jest.fn().mockResolvedValue(undefined) }))

import { sendAdminAlert } from '@/lib/alerts'
import { maybeRunOpsSelfCheck, runOpsSelfCheck } from '@/lib/ops/self-check'
import { prisma } from '@/lib/prisma'

const p = prisma as unknown as {
  analyticsEvent: { findFirst: jest.Mock }
  inboxMessage: { findFirst: jest.Mock }
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)
const realFetch = global.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: string }) {
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { status, body = '' } = handler(String(url), init)
    return {
      status,
      text: async () => body,
      json: async () => JSON.parse(body || '{}'),
    } as Response
  }) as unknown as typeof fetch
}

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, STRIPE_WEBHOOK_SECRET: 'whsec_test', NEXT_PUBLIC_APP_URL: 'https://resumeai-bot.com' }
  // Healthy by default; the inbound tests override it.
  p.inboxMessage.findFirst.mockResolvedValue({ receivedAt: daysAgo(1) })
})
afterEach(() => {
  global.fetch = realFetch
  process.env = OLD_ENV
})

describe('runOpsSelfCheck', () => {
  it('passes when every check is healthy', async () => {
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 200, body: 'Rescue for $4.99 today' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"too short"}' }
      if (url.endsWith('/api/webhooks/stripe')) return { status: 200 }
      return { status: 404 }
    })
    const r = await runOpsSelfCheck()
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
  })

  it('flags a down tripwire page', async () => {
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 500, body: '' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"x"}' }
      return { status: 200 }
    })
    const r = await runOpsSelfCheck()
    expect(r.ok).toBe(false)
    expect(r.failures.some((f) => f.includes('tripwire'))).toBe(true)
  })

  it('flags a webhook that accepts an unsigned/failed event (500)', async () => {
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 200, body: '$4.99' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"x"}' }
      if (url.endsWith('/api/webhooks/stripe')) return { status: 500 }
      return { status: 200 }
    })
    const r = await runOpsSelfCheck()
    expect(r.ok).toBe(false)
    expect(r.failures.some((f) => f.includes('stripe webhook'))).toBe(true)
  })
})

describe('maybeRunOpsSelfCheck', () => {
  it('skips inside the 5h window', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue({ id: 'recent' })
    const r = await maybeRunOpsSelfCheck()
    expect(r).toBe('skipped')
  })

  it('runs and alerts P0.4 on failure', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue(null)
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 503, body: '' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"x"}' }
      return { status: 200 }
    })
    const r = await maybeRunOpsSelfCheck()
    expect(r).toBe('ran')
    expect(sendAdminAlert).toHaveBeenCalledTimes(1)
  })

  it('runs silently on success (no alert)', async () => {
    p.analyticsEvent.findFirst.mockResolvedValue(null)
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 200, body: '$4.99' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"x"}' }
      return { status: 200 }
    })
    const r = await maybeRunOpsSelfCheck()
    expect(r).toBe('ran')
    expect(sendAdminAlert).not.toHaveBeenCalled()
  })
})

/**
 * Inbound mail stopped on 2026-07-22 and nobody noticed for nine days: nothing
 * threw, nothing 500'd, the MX record just stopped delivering after the domain
 * migration, and a queue receiving nothing looks exactly like a quiet week.
 *
 * This is the only check here where ABSENCE is the alarm, so it is the only one
 * that can catch that class of outage at all.
 */
describe('inbound mail silence', () => {
  function healthyFetch() {
    mockFetch((url) => {
      if (url.endsWith('/resume-rescue')) return { status: 200, body: 'Rescue for $4.99 today' }
      if (url.endsWith('/api/ats-check')) return { status: 400, body: '{"error":"too short"}' }
      if (url.endsWith('/api/webhooks/stripe')) return { status: 200 }
      return { status: 404 }
    })
  }

  it('is quiet while mail is still arriving', async () => {
    healthyFetch()
    p.inboxMessage.findFirst.mockResolvedValue({ receivedAt: daysAgo(2) })
    expect((await runOpsSelfCheck()).ok).toBe(true)
  })

  it('fires once the queue has been silent for more than three days', async () => {
    healthyFetch()
    p.inboxMessage.findFirst.mockResolvedValue({ receivedAt: daysAgo(9) })
    const r = await runOpsSelfCheck()
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/no inbound mail for 9 days/)
  })

  it('names the two things that actually break it', async () => {
    healthyFetch()
    p.inboxMessage.findFirst.mockResolvedValue({ receivedAt: daysAgo(30) })
    const [failure] = (await runOpsSelfCheck()).failures
    expect(failure).toMatch(/MX record/)
    expect(failure).toMatch(/Resend/)
  })

  it('stays quiet on a fresh install that has never received mail', async () => {
    healthyFetch()
    p.inboxMessage.findFirst.mockResolvedValue(null)
    expect((await runOpsSelfCheck()).ok).toBe(true)
  })

  it('reports a database error rather than swallowing it', async () => {
    healthyFetch()
    p.inboxMessage.findFirst.mockRejectedValue(new Error('connection refused'))
    const r = await runOpsSelfCheck()
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/inbound check failed/)
  })
})
