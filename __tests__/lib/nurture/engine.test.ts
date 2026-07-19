/**
 * Unit tests for the nurture engine (lib/nurture) — the compliance-critical
 * guarantees: suppression is absolute, purchase stops the sequence, the
 * abandoned-checkout email sends exactly once, and stage advancement is
 * correct. Prisma/email/stripe mocked.
 */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    emailSuppression: { findUnique: jest.fn(), upsert: jest.fn() },
    rescueOrder: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn() },
  },
}))

const sendEmail = jest.fn().mockResolvedValue({ success: true })
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))

jest.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { retrieve: jest.fn().mockResolvedValue({ status: 'open', url: 'https://checkout.stripe.com/x' }) } } },
}))

jest.mock('@/lib/analytics-advanced', () => ({
  trackEvent: jest.fn().mockResolvedValue(undefined),
}))

import { enrollLead, processAbandonedCheckouts, processNurtureQueue } from '@/lib/nurture'
import { prisma } from '@/lib/prisma'

const p = prisma as unknown as {
  lead: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock; create: jest.Mock }
  emailSuppression: { findUnique: jest.Mock; upsert: jest.Mock }
  rescueOrder: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock }
  user: { findFirst: jest.Mock }
}

const baseLead = {
  id: 'lead1',
  email: 'lead@example.com',
  source: 'ats-check',
  nurtureStage: 1,
  nurtureNextAt: new Date(Date.now() - 1000),
  unsubscribedAt: null,
  convertedAt: null,
  consentAt: new Date(),
  lastScore: 55,
  lastJobTitle: 'Support Engineer',
  createdAt: new Date(),
}

beforeEach(() => {
  jest.clearAllMocks()
  sendEmail.mockResolvedValue({ success: true })
  p.emailSuppression.findUnique.mockResolvedValue(null)
  p.rescueOrder.findFirst.mockResolvedValue(null)
  p.user.findFirst.mockResolvedValue(null)
  p.lead.update.mockResolvedValue({})
  p.rescueOrder.update.mockResolvedValue({})
})

describe('processNurtureQueue', () => {
  it('sends the due stage and schedules the next', async () => {
    p.lead.findMany.mockResolvedValue([{ ...baseLead }])
    const sent = await processNurtureQueue()
    expect(sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const update = p.lead.update.mock.calls[0][0].data
    expect(update.nurtureStage).toBe(2)
    expect(update.nurtureNextAt).toBeInstanceOf(Date)
  })

  it('final stage ends the sequence (nurtureNextAt null)', async () => {
    p.lead.findMany.mockResolvedValue([{ ...baseLead, nurtureStage: 3 }])
    await processNurtureQueue()
    const update = p.lead.update.mock.calls[0][0].data
    expect(update.nurtureStage).toBe(4)
    expect(update.nurtureNextAt).toBeNull()
  })

  it('NEVER emails a suppressed address', async () => {
    p.lead.findMany.mockResolvedValue([{ ...baseLead }])
    p.emailSuppression.findUnique.mockResolvedValue({ email: baseLead.email })
    const sent = await processNurtureQueue()
    expect(sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.lead.update.mock.calls[0][0].data.nurtureNextAt).toBeNull()
  })

  it('stops the sequence when the lead has purchased', async () => {
    p.lead.findMany.mockResolvedValue([{ ...baseLead }])
    p.rescueOrder.findFirst.mockResolvedValue({ id: 'order1' })
    const sent = await processNurtureQueue()
    expect(sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    const update = p.lead.update.mock.calls[0][0].data
    expect(update.convertedAt).toBeInstanceOf(Date)
    expect(update.nurtureNextAt).toBeNull()
  })

  it('retries the same stage later when the email send fails', async () => {
    p.lead.findMany.mockResolvedValue([{ ...baseLead }])
    sendEmail.mockResolvedValue({ success: false })
    const sent = await processNurtureQueue()
    expect(sent).toBe(0)
    const update = p.lead.update.mock.calls[0][0].data
    expect(update.nurtureStage).toBeUndefined()
    expect(update.nurtureNextAt).toBeInstanceOf(Date)
  })
})

describe('processAbandonedCheckouts', () => {
  const order = {
    id: 'order1',
    email: 'buyer@example.com',
    jobTitle: 'Support Engineer',
    jobCompany: 'Acme',
    stripeSessionId: 'cs_123',
    createdAt: new Date(Date.now() - 5 * 3600_000),
    abandonedEmailAt: null,
  }

  it('sends exactly one reminder and stamps abandonedEmailAt', async () => {
    p.rescueOrder.findMany.mockResolvedValue([{ ...order }])
    const sent = await processAbandonedCheckouts()
    expect(sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0].html).toContain('checkout.stripe.com')
    expect(p.rescueOrder.update.mock.calls[0][0].data.abandonedEmailAt).toBeInstanceOf(Date)
  })

  it('suppressed buyers get stamped but never emailed', async () => {
    p.rescueOrder.findMany.mockResolvedValue([{ ...order }])
    p.emailSuppression.findUnique.mockResolvedValue({ email: order.email })
    const sent = await processAbandonedCheckouts()
    expect(sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.rescueOrder.update).toHaveBeenCalled()
  })
})

describe('enrollLead', () => {
  it('refuses to enroll a suppressed email', async () => {
    p.emailSuppression.findUnique.mockResolvedValue({ email: 'x@y.com' })
    const lead = await enrollLead({ email: 'x@y.com', source: 'ats-check' })
    expect(lead).toBeNull()
    expect(p.lead.create).not.toHaveBeenCalled()
  })

  it('creates a new lead at stage 1 with the next step in ~2 days', async () => {
    p.lead.findFirst.mockResolvedValue(null)
    p.lead.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'new', ...data }))
    const lead = await enrollLead({ email: 'new@y.com', source: 'ats-check', score: 61 })
    expect(lead).not.toBeNull()
    const data = p.lead.create.mock.calls[0][0].data
    expect(data.nurtureStage).toBe(1)
    expect(data.consentAt).toBeInstanceOf(Date)
    const days = (data.nurtureNextAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(1.9)
    expect(days).toBeLessThan(2.1)
  })
})
