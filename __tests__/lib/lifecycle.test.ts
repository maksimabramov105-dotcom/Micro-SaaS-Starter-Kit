/**
 * User lifecycle emails (P4.3).
 *
 * Behaviour, not shape. The failure modes that matter for a retention email are
 * all "sent when it shouldn't have been": twice, to someone who unsubscribed,
 * before it was due, or a backlog dumped at once after an outage.
 */
const mockSendEmail = jest.fn()
const mockTrack = jest.fn()
const mockIsSuppressed = jest.fn()
const mockPrisma = {
  user: { findMany: jest.fn() },
  analyticsEvent: { findMany: jest.fn(), findFirst: jest.fn() },
  jobApplication: { count: jest.fn() },
  inboxMessage: { count: jest.fn() },
  resume: { count: jest.fn() },
}

// Getter, not a direct reference: jest hoists this factory above the `const`
// declarations, so dereferencing mockPrisma eagerly hits the temporal dead zone
// when lib/lifecycle imports prisma at module load.
jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: (...a: unknown[]) => mockTrack(...a) }))
jest.mock('@/lib/nurture', () => ({ isSuppressed: (...a: unknown[]) => mockIsSuppressed(...a) }))

import { processLifecycleEmails, sendWelcome } from '@/lib/lifecycle'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)

beforeEach(() => {
  jest.clearAllMocks()
  mockSendEmail.mockResolvedValue({ success: true })
  mockTrack.mockResolvedValue(undefined)
  mockIsSuppressed.mockResolvedValue(false)
  mockPrisma.analyticsEvent.findMany.mockResolvedValue([])
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue(null)
  mockPrisma.jobApplication.count.mockResolvedValue(0)
  mockPrisma.inboxMessage.count.mockResolvedValue(0)
  mockPrisma.resume.count.mockResolvedValue(0)
})

describe('processLifecycleEmails', () => {
  it('sends nothing to a user who is not due yet', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(2) },
    ])
    expect(await processLifecycleEmails()).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('sends day1 once the user is 24h old', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(25) },
    ])
    expect(await processLifecycleEmails()).toBe(1)
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { stage: 'day1' } }),
    )
  })

  it('never repeats a stage already recorded', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(25) },
    ])
    mockPrisma.analyticsEvent.findMany.mockResolvedValue([
      { userId: 'u1', properties: { stage: 'day1' } },
    ])
    expect(await processLifecycleEmails()).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does NOT dump a backlog after an outage — sends only the most recent due stage', async () => {
    // 8 days old with nothing sent: day1, day3 and day7 are all "due".
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(24 * 8) },
    ])
    expect(await processLifecycleEmails()).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { stage: 'day7' } }),
    )
  })

  it('respects the shared suppression list', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(25) },
    ])
    mockIsSuppressed.mockResolvedValue(true)
    expect(await processLifecycleEmails()).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('skips day1 when the user already made a resume, rather than sending a tone-deaf email', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@b.c', name: 'Ada', createdAt: hoursAgo(25) },
    ])
    mockPrisma.resume.count.mockResolvedValue(2)
    expect(await processLifecycleEmails()).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
    // still marked, so it is not retried forever
    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { stage: 'day1', skipped: 'has_resume' } }),
    )
  })

  it('honours the batch limit', async () => {
    mockPrisma.user.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`, email: `u${i}@b.c`, name: 'X', createdAt: hoursAgo(25),
      })),
    )
    expect(await processLifecycleEmails(3)).toBe(3)
  })
})

describe('sendWelcome', () => {
  it('sends on first call', async () => {
    await sendWelcome('u1', 'a@b.c', 'Ada')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('does not send twice', async () => {
    mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ id: 'x' })
    await sendWelcome('u1', 'a@b.c', 'Ada')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('never throws — signup must not fail because an email did', async () => {
    mockPrisma.analyticsEvent.findFirst.mockRejectedValue(new Error('db down'))
    await expect(sendWelcome('u1', 'a@b.c', 'Ada')).resolves.toBeUndefined()
  })
})
