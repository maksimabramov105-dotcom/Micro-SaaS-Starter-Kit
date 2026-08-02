/**
 * @jest-environment node
 *
 * POST /api/lead — the capture endpoint that kept none of the funnel's rules.
 *
 * It was `prisma.lead.create({ email, source })` and nothing else. An address
 * that had unsubscribed could be written straight back in; consentAt stayed
 * null; nurtureStage/nurtureNextAt kept their defaults, and processNurtureQueue
 * only selects rows with BOTH a due nurtureNextAt and a non-null consentAt — so
 * every address captured here was enrolled in nothing and could never receive
 * anything. The exit-intent modal (T3) posted here and told people the report
 * was on its way.
 *
 * These pin the three rules enrollLead() exists to keep, plus the one thing this
 * endpoint deliberately does NOT do: send mail.
 */
const mockEnrollLead = jest.fn()
const mockTrackEvent = jest.fn()
const mockSendEmail = jest.fn()

jest.mock('@/lib/nurture', () => ({ enrollLead: (...a: unknown[]) => mockEnrollLead(...a) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: (...a: unknown[]) => mockTrackEvent(...a) }))
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }))
// Rate limiter: fail-open, as in production when Redis is unavailable.
jest.mock('@/lib/redis', () => ({ redisTry: async (_fn: unknown, fallback: unknown) => fallback }))

import { POST } from '@/app/api/lead/route'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  jest.resetAllMocks()
  mockEnrollLead.mockResolvedValue({ id: 'lead_1' })
  mockTrackEvent.mockResolvedValue(undefined)
})

it('captures through enrollLead, which is where suppression and consent live', async () => {
  const res = await post({ email: 'A@B.co', source: 'some-lander', consent: true })
  expect(res.status).toBe(200)
  expect(mockEnrollLead).toHaveBeenCalledWith({ email: 'a@b.co', source: 'some-lander' })
})

it('refuses to process an address without explicit consent (C4)', async () => {
  const res = await post({ email: 'a@b.co', source: 'x' })
  expect(res.status).toBe(400)
  expect(mockEnrollLead).not.toHaveBeenCalled()
})

it('treats consent: "true" as missing — only the boolean counts', async () => {
  const res = await post({ email: 'a@b.co', source: 'x', consent: 'true' })
  expect(res.status).toBe(400)
  expect(mockEnrollLead).not.toHaveBeenCalled()
})

it('an unsubscribed address is answered ok but never re-added', async () => {
  // enrollLead returns null for a suppressed address.
  mockEnrollLead.mockResolvedValue(null)
  const res = await post({ email: 'gone@b.co', source: 'x', consent: true })
  expect(res.status).toBe(200)
  // No row, so nothing to attribute: a suppressed address must not inflate
  // capture counts either.
  expect(mockTrackEvent).not.toHaveBeenCalled()
})

it('records the capture so attribution can see it', async () => {
  await post({ email: 'a@b.co', source: 'ats-check-exit', consent: true })
  expect(mockTrackEvent).toHaveBeenCalledWith({
    event: 'lead_captured',
    properties: { leadId: 'lead_1', source: 'ats-check-exit' },
  })
})

it('sends nothing itself — a caller that promises an email must send it', async () => {
  await post({ email: 'a@b.co', source: 'x', consent: true })
  expect(mockSendEmail).not.toHaveBeenCalled()
})

it('still rejects a malformed address', async () => {
  for (const email of ['', 'nope', 'a@b', `${'x'.repeat(200)}@b.co`]) {
    const res = await post({ email, source: 'x', consent: true })
    expect(res.status).toBe(400)
  }
  expect(mockEnrollLead).not.toHaveBeenCalled()
})

it('reports a real failure instead of claiming success', async () => {
  mockEnrollLead.mockRejectedValue(new Error('db down'))
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const res = await post({ email: 'a@b.co', source: 'x', consent: true })
  expect(res.status).toBe(500)
  spy.mockRestore()
})
