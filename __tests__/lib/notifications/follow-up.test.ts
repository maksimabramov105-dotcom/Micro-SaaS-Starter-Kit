/**
 * Tests for lib/notifications/follow-up.ts — no-response follow-up nudges.
 * No DB / no network: prisma and sendEmail are mocked.
 */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    jobApplication: { findMany: jest.fn() },
    applicationEvent: { createMany: jest.fn() },
  },
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }))

import { runFollowUpNudges } from '@/lib/notifications/follow-up'
const { prisma } = require('@/lib/prisma')
const { sendEmail } = require('@/lib/email')

function app(id: string, userId: string, email: string | null, days = 10) {
  return {
    id,
    userId,
    jobTitle: `Role ${id}`,
    company: `Co ${id}`,
    appliedAt: new Date(Date.now() - days * 86_400_000),
    user: { email, name: 'Maxim Vdovenko' },
  }
}

beforeEach(() => {
  ;(sendEmail as jest.Mock).mockReset().mockResolvedValue(undefined)
  ;(prisma.applicationEvent.createMany as jest.Mock).mockReset().mockResolvedValue({ count: 0 })
  ;(prisma.jobApplication.findMany as jest.Mock).mockReset()
})

describe('runFollowUpNudges', () => {
  it('dryRun computes counts WITHOUT sending or marking', async () => {
    ;(prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([
      app('a', 'u1', 'u1@x.com'),
      app('b', 'u1', 'u1@x.com'),
    ])
    const r = await runFollowUpNudges({ dryRun: true })
    expect(r).toMatchObject({ candidates: 2, usersNotified: 1, appsNudged: 2, dryRun: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(prisma.applicationEvent.createMany).not.toHaveBeenCalled()
  })

  it('sends ONE email per user and marks each application nudged', async () => {
    ;(prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([
      app('a', 'u1', 'u1@x.com'),
      app('b', 'u1', 'u1@x.com'),
      app('c', 'u2', 'u2@x.com'),
    ])
    const r = await runFollowUpNudges({})
    expect(sendEmail).toHaveBeenCalledTimes(2) // u1 + u2
    expect(r.usersNotified).toBe(2)
    expect(r.appsNudged).toBe(3)
    // Each user's apps are marked nudged via createMany.
    expect(prisma.applicationEvent.createMany).toHaveBeenCalledTimes(2)
    const firstCall = (prisma.applicationEvent.createMany as jest.Mock).mock.calls[0][0]
    expect(firstCall.data[0]).toMatchObject({ type: 'followup_nudged' })
  })

  it('skips users with no email and does not crash', async () => {
    ;(prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([app('a', 'u1', null)])
    const r = await runFollowUpNudges({})
    expect(sendEmail).not.toHaveBeenCalled()
    expect(r.usersNotified).toBe(0)
  })

  it('does NOT mark nudged when the email fails (so it retries next run)', async () => {
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error('resend down'))
    ;(prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([app('a', 'u1', 'u1@x.com')])
    const r = await runFollowUpNudges({})
    expect(prisma.applicationEvent.createMany).not.toHaveBeenCalled()
    expect(r.appsNudged).toBe(0)
  })
})
