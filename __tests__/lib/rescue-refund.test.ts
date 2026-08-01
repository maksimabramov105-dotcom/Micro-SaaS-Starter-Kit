/**
 * @jest-environment node
 *
 * Resume Rescue: what happens when generation fails after we took the money.
 *
 * This is the promise the tripwire is sold on — "if generation fails, the
 * payment is refunded automatically rather than waiting for you to ask" — and
 * it had no test at all. It is also the one path a buyer experiences at their
 * angriest, so silence or a half-refund here is worse than never selling to
 * them.
 *
 * The launch audit exercised the happy path with a real $0 purchase (delivered
 * in 2m58s). Deliberately simulating an OpenAI outage against production would
 * have broken real orders, so the failure path is proven here instead.
 */
const mockPrisma = {
  rescueOrder: { findUnique: jest.fn(), update: jest.fn() },
}
const mockRedis = { set: jest.fn(), del: jest.fn() }
const mockCallWorker = jest.fn()
const mockRefund = jest.fn()
const mockApology = jest.fn()
const mockDelivery = jest.fn()
const mockAdminAlert = jest.fn()

jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/redis', () => ({ getRedis: () => mockRedis, redisTry: async (f: (c: unknown) => unknown) => f(mockRedis) }))
jest.mock('@/lib/worker-client', () => ({
  callWorker: (...a: unknown[]) => mockCallWorker(...a),
  WorkerError: class extends Error {},
}))
jest.mock('@/lib/stripe', () => ({
  stripe: {
    refunds: { create: (...a: unknown[]) => mockRefund(...a) },
    coupons: { create: jest.fn() },
    promotionCodes: { create: jest.fn() },
    checkout: { sessions: { retrieve: jest.fn() } },
  },
}))
jest.mock('@/lib/rescue/emails', () => ({
  sendRescueApologyEmail: (...a: unknown[]) => mockApology(...a),
  sendRescueDeliveryEmail: (...a: unknown[]) => mockDelivery(...a),
}))
jest.mock('@/lib/alerts', () => ({ sendAdminAlert: (...a: unknown[]) => mockAdminAlert(...a) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: jest.fn().mockResolvedValue(undefined) }))

import { processRescueOrder } from '@/lib/rescue/generate'

const ORDER = {
  id: 'ord_1',
  email: 'buyer@example.com',
  status: 'PAID',
  attempts: 0,
  error: null,
  paymentIntentId: 'pi_123',
  amountPaid: 499,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRedis.set.mockResolvedValue('OK')
  mockRedis.del.mockResolvedValue(1)
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER })
  mockPrisma.rescueOrder.update.mockImplementation(async ({ data }: { data: object }) => ({
    ...ORDER,
    ...data,
  }))
  mockRefund.mockResolvedValue({ id: 're_1', status: 'succeeded' })
  mockApology.mockResolvedValue(undefined)
  mockAdminAlert.mockResolvedValue(undefined)
})

it('does not refund on the first failure — it retries once', async () => {
  // One regeneration is the documented policy; refunding immediately would
  // throw away a sale that a transient OpenAI blip would have completed.
  mockCallWorker.mockRejectedValue(new Error('OpenAI 503'))
  await processRescueOrder('ord_1')
  expect(mockRefund).not.toHaveBeenCalled()
})

it('refunds once the attempt limit is reached', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, attempts: 2, error: 'OpenAI 503' })
  await processRescueOrder('ord_1')
  expect(mockRefund).toHaveBeenCalledTimes(1)
  expect(mockRefund.mock.calls[0][0]).toMatchObject({ payment_intent: 'pi_123' })
})

it('apologises to the buyer, not just the founder', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, attempts: 2, error: 'boom' })
  await processRescueOrder('ord_1')
  expect(mockApology).toHaveBeenCalledTimes(1)
  expect(mockApology.mock.calls[0][0]).toBe('buyer@example.com')
})

it('alerts the founder, so a failed sale is never silent', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, attempts: 2, error: 'boom' })
  await processRescueOrder('ord_1')
  expect(mockAdminAlert).toHaveBeenCalledTimes(1)
})

it('still apologises and alerts when the Stripe refund itself fails', async () => {
  // The worst case: we cannot give the money back automatically. The buyer must
  // still hear from us, and the founder must know to refund by hand.
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, attempts: 2, error: 'boom' })
  mockRefund.mockRejectedValue(new Error('charge already refunded'))
  await processRescueOrder('ord_1')
  expect(mockApology).toHaveBeenCalledTimes(1)
  expect(mockAdminAlert).toHaveBeenCalledTimes(1)
  expect(String(mockAdminAlert.mock.calls[0][0])).toMatch(/refund manually/i)
})

it('does not report a failed refund for an order that was never charged', async () => {
  // A 100%-off promo order has no payment intent. Alerting "refund FAILED"
  // there trains you to ignore the one alert that means money is actually
  // stuck. The code already gets this right; this pins it.
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({
    ...ORDER, attempts: 2, error: 'boom', paymentIntentId: null,
  })
  await processRescueOrder('ord_1')
  expect(mockRefund).not.toHaveBeenCalled()
  expect(String(mockAdminAlert.mock.calls[0][0])).not.toMatch(/refund manually/i)
  expect(mockApology).toHaveBeenCalledTimes(1)
})

it('never delivers an artifact when generation failed', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, attempts: 2, error: 'boom' })
  await processRescueOrder('ord_1')
  expect(mockDelivery).not.toHaveBeenCalled()
})

it('yields to another runner holding the lock rather than double-charging work', async () => {
  mockRedis.set.mockResolvedValue(null)
  expect(await processRescueOrder('ord_1')).toBeNull()
  expect(mockCallWorker).not.toHaveBeenCalled()
})

it('ignores an order that is not awaiting generation', async () => {
  mockPrisma.rescueOrder.findUnique.mockResolvedValue({ ...ORDER, status: 'DELIVERED' })
  await processRescueOrder('ord_1')
  expect(mockCallWorker).not.toHaveBeenCalled()
  expect(mockRefund).not.toHaveBeenCalled()
})
