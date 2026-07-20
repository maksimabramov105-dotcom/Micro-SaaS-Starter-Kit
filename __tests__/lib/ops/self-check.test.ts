/**
 * Tests for the money-path self-check: pass/fail detection across the three
 * checks and that failures alert via P0.4. fetch + prisma + alerts mocked.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: { analyticsEvent: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/alerts', () => ({ sendAdminAlert: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: jest.fn().mockResolvedValue(undefined) }))

import { sendAdminAlert } from '@/lib/alerts'
import { maybeRunOpsSelfCheck, runOpsSelfCheck } from '@/lib/ops/self-check'
import { prisma } from '@/lib/prisma'

const p = prisma as unknown as { analyticsEvent: { findFirst: jest.Mock } }
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
  process.env = { ...OLD_ENV, STRIPE_WEBHOOK_SECRET: 'whsec_test', NEXT_PUBLIC_APP_URL: 'https://resumeai-bot.ru' }
})
afterEach(() => {
  global.fetch = realFetch
  process.env = OLD_ENV
})

describe('runOpsSelfCheck', () => {
  it('passes when all three checks are healthy', async () => {
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
