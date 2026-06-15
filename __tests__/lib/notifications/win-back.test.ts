/**
 * Tests for lib/notifications/win-back.ts — cancel re-engagement.
 * No DB / no network: prisma and sendEmail are mocked.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/promo', () => ({
  PROMO: { code: 'LAUNCH40', discountLabel: '40% off your first year', endsAt: '2026-09-01T23:59:59Z' },
  isPromoActive: jest.fn(),
}))

import { runWinBack, buildWinBackEmail } from '@/lib/notifications/win-back'
const { prisma } = require('@/lib/prisma')
const { sendEmail } = require('@/lib/email')
const { isPromoActive } = require('@/lib/promo')

beforeEach(() => {
  ;(sendEmail as jest.Mock).mockReset().mockResolvedValue(undefined)
  ;(prisma.user.findMany as jest.Mock).mockReset()
  ;(prisma.user.update as jest.Mock).mockReset().mockResolvedValue({})
  ;(isPromoActive as jest.Mock).mockReset().mockReturnValue(false)
})

describe('runWinBack', () => {
  it('emails each due user once and stamps winBackSentAt', async () => {
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'u1', email: 'a@x.com', name: 'Maxim Vdovenko' },
      { id: 'u2', email: 'b@x.com', name: null },
    ])
    const r = await runWinBack({})
    expect(r).toMatchObject({ due: 2, sent: 2, dryRun: false })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(prisma.user.update).toHaveBeenCalledTimes(2)
    expect((prisma.user.update as jest.Mock).mock.calls[0][0].data).toHaveProperty('winBackSentAt')
  })

  it('dryRun computes counts WITHOUT sending or marking', async () => {
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', email: 'a@x.com', name: 'A' }])
    const r = await runWinBack({ dryRun: true })
    expect(r).toMatchObject({ due: 1, sent: 0, dryRun: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('queries only un-resubscribed, not-yet-sent, past-due users', async () => {
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([])
    await runWinBack({ now: new Date('2026-06-15T00:00:00Z') })
    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.winBackSentAt).toBeNull()
    expect(where.stripeSubscriptionId).toBeNull() // did NOT resubscribe
    expect(where.winBackAt.lte).toBeInstanceOf(Date)
    expect(where.winBackAt.not).toBeNull()
  })

  it('skips users with no email but still counts them as due', async () => {
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', email: null, name: 'X' }])
    const r = await runWinBack({})
    expect(r.due).toBe(1)
    expect(r.sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('buildWinBackEmail', () => {
  const now = new Date('2026-06-15T00:00:00Z')

  it('includes the promo offer only when a promo is active', () => {
    ;(isPromoActive as jest.Mock).mockReturnValue(true)
    expect(buildWinBackEmail('Maxim', now).html).toContain('LAUNCH40')
    ;(isPromoActive as jest.Mock).mockReturnValue(false)
    expect(buildWinBackEmail('Maxim', now).html).not.toContain('LAUNCH40')
  })

  it('uses the first name and is honest (congratulates if they got the job)', () => {
    const { subject, html } = buildWinBackEmail('Maxim Vdovenko', now)
    expect(subject).toContain('Maxim')
    expect(html).toMatch(/congratulations|got the job/i)
    expect(html).toContain('/pricing')
  })

  it('escapes HTML in the name', () => {
    const { html } = buildWinBackEmail('<script>x</script>', now)
    expect(html).not.toContain('<script>')
  })
})
