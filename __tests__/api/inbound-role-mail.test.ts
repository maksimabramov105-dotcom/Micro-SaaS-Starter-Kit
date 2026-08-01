/**
 * @jest-environment node
 *
 * Role-address mail must reach a human.
 *
 * Found by the launch audit: a probe sent to support@resumeai-bot.com produced
 *
 *   [inbox/inbound] no user for handle support
 *
 * and nothing else. The message was not stored, not forwarded, not alerted —
 * discarded. That address is published in the site footer, on /contact, and as
 * the reply-to on EVERY email the product sends, including the refund policy's
 * "contact us". A customer asking for a refund under the 30-day guarantee got
 * silence, which is how a refund request becomes a chargeback.
 */
const mockPrisma = { user: { findUnique: jest.fn() } }
const mockSendEmail = jest.fn()
const mockAdminAlert = jest.fn()
const mockVerify = jest.fn()

jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }))
jest.mock('@/lib/alerts', () => ({
  sendAdminAlert: (...a: unknown[]) => mockAdminAlert(...a),
  sendAdminMessage: jest.fn(),
}))
jest.mock('@/lib/inbox/classify', () => ({ classifyEmail: () => 'QUESTION' }))
jest.mock('@/lib/funnel', () => ({ recordFunnel: jest.fn() }))
jest.mock('@/lib/inbox/notify', () => ({ notifyHumanReply: jest.fn(), shouldNotify: () => false }))
jest.mock('@/lib/redis', () => ({ publishEvent: jest.fn() }))
jest.mock('@/lib/inbox/inbound-utils', () => {
  const actual = jest.requireActual('@/lib/inbox/inbound-utils')
  return { ...actual, verifyResendSignature: (...a: unknown[]) => mockVerify(...a) }
})

import { POST } from '@/app/api/inbox/inbound/route'

function inbound(to: string, subject = 'Refund please') {
  return new Request('http://localhost/api/inbox/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'email.received',
      data: { to, from: 'Jane Buyer <jane@example.com>', subject, text: 'I would like a refund.' },
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockReturnValue(true)
  mockSendEmail.mockResolvedValue({ success: true })
  mockAdminAlert.mockResolvedValue(undefined)
  mockPrisma.user.findUnique.mockResolvedValue(null)
  process.env.OWNER_EMAIL = 'founder@example.com'
  process.env.INBOX_DOMAIN = 'resumeai-bot.com'
})

it('forwards support@ to a real mailbox instead of dropping it', async () => {
  const res = await POST(inbound('support@resumeai-bot.com'))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ forwarded: 'support' })
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
  expect(mockSendEmail.mock.calls[0][0].to).toBe('founder@example.com')
})

it('makes the sender the reply-to, so replying just works', async () => {
  await POST(inbound('support@resumeai-bot.com'))
  expect(mockSendEmail.mock.calls[0][0].replyTo).toContain('jane@example.com')
})

it('alerts Telegram too — an unread inbox is how a refund becomes a chargeback', async () => {
  await POST(inbound('support@resumeai-bot.com'))
  expect(mockAdminAlert).toHaveBeenCalledTimes(1)
  expect(String(mockAdminAlert.mock.calls[0][0])).toContain('jane@example.com')
})

it.each(['hello', 'help', 'billing', 'privacy', 'legal', 'abuse'])(
  'covers the other published role address: %s@',
  async (handle) => {
    const res = await POST(inbound(`${handle}@resumeai-bot.com`))
    expect(await res.json()).toMatchObject({ forwarded: handle })
  },
)

it('still ignores a genuinely unknown handle', async () => {
  const res = await POST(inbound('nobody-abc123@resumeai-bot.com'))
  expect(await res.json()).toMatchObject({ skipped: 'unknown_handle' })
  expect(mockSendEmail).not.toHaveBeenCalled()
})

it('never fails the webhook when forwarding breaks', async () => {
  // A 500 makes Resend retry forever; losing one forward is better.
  mockSendEmail.mockRejectedValue(new Error('resend down'))
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
  const res = await POST(inbound('support@resumeai-bot.com'))
  expect(res.status).toBe(200)
  quiet.mockRestore()
})

it('still alerts even when no destination mailbox is configured', async () => {
  delete process.env.OWNER_EMAIL
  const prev = process.env.ADMIN_EMAILS
  delete process.env.ADMIN_EMAILS
  const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {})
  await POST(inbound('support@resumeai-bot.com'))
  expect(mockSendEmail).not.toHaveBeenCalled()
  expect(mockAdminAlert).toHaveBeenCalled()
  quiet.mockRestore()
  if (prev) process.env.ADMIN_EMAILS = prev
})
