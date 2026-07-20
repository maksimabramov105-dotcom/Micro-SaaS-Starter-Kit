/**
 * Unit tests for the Resume Rescue order processor (lib/rescue/generate.ts).
 * Focus: the money-critical guarantees — locking, retry-then-refund, and
 * that a successful generation delivers exactly once.
 */

const redisSet = jest.fn()
const redisDel = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/redis', () => ({
  getRedis: () => ({ set: redisSet, del: redisDel }),
  publishEvent: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    rescueOrder: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    resume: { create: jest.fn() },
  },
}))

const refundCreate = jest.fn().mockResolvedValue({ id: 're_1' })
const couponCreate = jest.fn().mockResolvedValue({ id: 'coup_1' })
const promoCreate = jest.fn().mockResolvedValue({ id: 'promo_1' })
jest.mock('@/lib/stripe', () => ({
  stripe: {
    refunds: { create: (...a: unknown[]) => refundCreate(...a) },
    coupons: { create: (...a: unknown[]) => couponCreate(...a) },
    promotionCodes: { create: (...a: unknown[]) => promoCreate(...a) },
  },
}))

const callWorker = jest.fn()
jest.mock('@/lib/worker-client', () => ({
  callWorker: (...a: unknown[]) => callWorker(...a),
  WorkerError: class WorkerError extends Error {},
}))

const deliveryEmail = jest.fn().mockResolvedValue(undefined)
const apologyEmail = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/rescue/emails', () => ({
  sendRescueDeliveryEmail: (...a: unknown[]) => deliveryEmail(...a),
  sendRescueApologyEmail: (...a: unknown[]) => apologyEmail(...a),
}))

const adminAlert = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/alerts', () => ({
  sendAdminAlert: (...a: unknown[]) => adminAlert(...a),
}))

jest.mock('@/lib/analytics-advanced', () => ({
  trackEvent: jest.fn().mockResolvedValue(undefined),
}))

import { processRescueOrder } from '@/lib/rescue/generate'
import { prisma } from '@/lib/prisma'

const mockPrisma = prisma as unknown as {
  rescueOrder: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock }
  resume: { create: jest.Mock }
}

const baseOrder = {
  id: 'order1',
  email: 'buyer@example.com',
  userId: 'user1',
  status: 'PAID',
  jobTitle: 'Support Engineer',
  jobCompany: 'Acme',
  jobUrl: null,
  jobDescription: 'desc',
  resumeText: 'resume text '.repeat(30),
  paymentIntentId: 'pi_123',
  resumeId: null,
  attempts: 0,
  error: null,
  paidAt: new Date(),
}

beforeEach(() => {
  jest.clearAllMocks()
  redisSet.mockResolvedValue('OK') // lock acquired by default
  mockPrisma.rescueOrder.update.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ ...baseOrder, ...data }),
  )
  mockPrisma.resume.create.mockResolvedValue({ id: 'resume1' })
})

test('returns null without touching the order when the lock is held elsewhere', async () => {
  redisSet.mockResolvedValue(null)
  const result = await processRescueOrder('order1')
  expect(result).toBeNull()
  expect(mockPrisma.rescueOrder.findUnique).not.toHaveBeenCalled()
})

test('happy path: generates, creates resume, delivers, emails', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...baseOrder })
  callWorker.mockResolvedValue({
    tailored_resume: { resume_text: 'tailored' },
    fit_report: { score: 72 },
    tokens_used: 1000,
    cached: false,
  })

  const result = await processRescueOrder('order1')

  expect(callWorker).toHaveBeenCalledWith('/jobs/resume-rescue', expect.objectContaining({
    resume_text: baseOrder.resumeText,
    order_id: 'order1',
  }))
  expect(mockPrisma.resume.create).toHaveBeenCalled()
  expect(deliveryEmail).toHaveBeenCalled()
  expect(refundCreate).not.toHaveBeenCalled()
  expect(result?.status).toBe('DELIVERED')
  expect(redisDel).toHaveBeenCalled() // lock released
})

test('first failure returns order to PAID for one retry, no refund yet', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...baseOrder, attempts: 0 })
  callWorker.mockRejectedValue(new Error('LLM exploded'))

  await processRescueOrder('order1')

  expect(refundCreate).not.toHaveBeenCalled()
  expect(apologyEmail).not.toHaveBeenCalled()
  const updates = mockPrisma.rescueOrder.update.mock.calls.map((c) => c[0].data)
  expect(updates.some((d: { status?: string }) => d.status === 'PAID')).toBe(true)
})

test('second failure auto-refunds, apologizes, and alerts the founder', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...baseOrder, attempts: 1 })
  callWorker.mockRejectedValue(new Error('LLM exploded again'))

  await processRescueOrder('order1')

  expect(refundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_123' })
  expect(apologyEmail).toHaveBeenCalledWith('buyer@example.com', 'refunded')
  expect(adminAlert).toHaveBeenCalled()
  const updates = mockPrisma.rescueOrder.update.mock.calls.map((c) => c[0].data)
  expect(updates.some((d: { status?: string }) => d.status === 'REFUNDED')).toBe(true)
})

// Regression (evidence sweep F1c): a fully-discounted order has no payment
// intent. Before this, it alerted "FAILED - refund manually in Stripe!" and
// emailed the customer that a refund was on its way — both untrue.
test('order with no captured payment reports nothing-to-refund, not a failed refund', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({
    ...baseOrder,
    attempts: 1,
    paymentIntentId: null,
  })
  callWorker.mockRejectedValue(new Error('LLM exploded again'))

  await processRescueOrder('order1')

  expect(refundCreate).not.toHaveBeenCalled()
  expect(apologyEmail).toHaveBeenCalledWith('buyer@example.com', 'nothing-to-refund')
  expect(adminAlert).toHaveBeenCalled()
  expect(adminAlert.mock.calls[0][0]).not.toMatch(/refund manually in Stripe/)
})

test('a genuinely failed Stripe refund still screams for manual intervention', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...baseOrder, attempts: 1 })
  callWorker.mockRejectedValue(new Error('LLM exploded again'))
  refundCreate.mockRejectedValue(new Error('stripe down'))

  await processRescueOrder('order1')

  expect(apologyEmail).toHaveBeenCalledWith('buyer@example.com', 'failed')
  expect(adminAlert.mock.calls[0][0]).toMatch(/refund manually in Stripe/)
  const updates = mockPrisma.rescueOrder.update.mock.calls.map((c) => c[0].data)
  expect(updates.some((d: { status?: string }) => d.status === 'FAILED')).toBe(true)
})

test('does nothing for orders that are not PAID/GENERATING', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED' })
  const result = await processRescueOrder('order1')
  expect(result?.status).toBe('DELIVERED')
  expect(callWorker).not.toHaveBeenCalled()
})
