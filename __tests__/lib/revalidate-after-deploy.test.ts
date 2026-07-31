/**
 * Post-deploy revalidation of statically-built, database-backed pages.
 *
 * The image is built with a dummy DATABASE_URL, so every statically rendered
 * page that reads the database is baked with the empty answer: /apply-to pages
 * without their live role lists, and — since P5.7 — / and /pricing with their
 * A/B experiments switched off.
 *
 * Observed live on 2026-07-31: both experiments were enabled at 50% and neither
 * page served the variant script, because the container was still serving the
 * flag-off HTML from build time. A restart made it worse, not better, since a
 * fresh container reverts to exactly that build output.
 *
 * The gating logic is the interesting part: skipping is only safe when the last
 * revalidation happened AFTER this process booted.
 */
const mockRevalidatePath = jest.fn()
const mockTrackEvent = jest.fn()
const mockPrisma = { analyticsEvent: { findFirst: jest.fn() } }

jest.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }))
jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: (...a: unknown[]) => mockTrackEvent(...a) }))

import { maybeRevalidateCompanyPages } from '@/lib/seo/revalidate-company-pages'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)

beforeEach(() => {
  jest.clearAllMocks()
  mockTrackEvent.mockResolvedValue(undefined)
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue(null)
})

function revalidated(): string[] {
  return mockRevalidatePath.mock.calls.map((c) => c[0] as string)
}

it('revalidates when nothing has run before', async () => {
  expect(await maybeRevalidateCompanyPages()).toBe('ran')
})

it('covers the A/B pages, not just the SEO pages', async () => {
  await maybeRevalidateCompanyPages()
  // / and /pricing read their rollout from FeatureFlag, which the build cannot
  // reach — so they are baked with the experiment off.
  expect(revalidated()).toEqual(expect.arrayContaining(['/', '/pricing']))
})

it('still covers every apply-to instance', async () => {
  await maybeRevalidateCompanyPages()
  expect(mockRevalidatePath).toHaveBeenCalledWith('/apply-to/[company]', 'page')
  expect(revalidated()).toContain('/apply-to')
})

it('runs when the refresh window has lapsed', async () => {
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ id: 'x', createdAt: hoursAgo(7) })
  expect(await maybeRevalidateCompanyPages()).toBe('ran')
})

it('runs again after a deploy, even inside the refresh window', async () => {
  // A marker from before this process booted describes pages the PREVIOUS
  // container marked stale — not the freshly-built HTML being served now.
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ id: 'x', createdAt: hoursAgo(1) })
  expect(await maybeRevalidateCompanyPages()).toBe('ran')
})

it('skips when this process already revalidated recently', async () => {
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue({
    id: 'x',
    createdAt: new Date(Date.now() + 1000),
  })
  expect(await maybeRevalidateCompanyPages()).toBe('skipped')
  expect(mockRevalidatePath).not.toHaveBeenCalled()
})

it('never throws — a cron tick must survive a revalidation failure', async () => {
  mockPrisma.analyticsEvent.findFirst.mockRejectedValue(new Error('db down'))
  const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await maybeRevalidateCompanyPages()).toBe('skipped')
  quiet.mockRestore()
})
