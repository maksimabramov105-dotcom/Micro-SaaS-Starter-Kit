/**
 * Daily IndexNow delta (T1).
 *
 * Before this, a new page waited up to seven days for the Monday full-sitemap
 * push before any search engine was told it existed. For a site whose growth
 * model is programmatic pages appearing as the job corpus grows, that was the
 * slowest step in the loop and the one part of indexing we actually control.
 *
 * The failure modes worth guarding are all "submitted the wrong set":
 * re-declaring unchanged URLs (which is what gets an IndexNow key ignored),
 * mistaking a cold start for 300 new pages, and — worst — advancing the
 * baseline after a rejected submission, which loses those URLs permanently.
 */
const mockPrisma = { analyticsEvent: { findFirst: jest.fn() } }
const mockTrack = jest.fn()
const mockGetSitemapUrls = jest.fn()
const mockSubmit = jest.fn()

jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))
jest.mock('@/lib/analytics-advanced', () => ({ trackEvent: (...a: unknown[]) => mockTrack(...a) }))
jest.mock('@/lib/seo/indexnow', () => ({
  getSitemapUrls: (...a: unknown[]) => mockGetSitemapUrls(...a),
  submitIndexNow: (...a: unknown[]) => mockSubmit(...a),
}))

import { runIndexNowDelta } from '@/lib/seo/indexnow-delta'

const A = 'https://resumeai-bot.com/a'
const B = 'https://resumeai-bot.com/b'
const C = 'https://resumeai-bot.com/c'

/** The properties payload of the most recent trackEvent call. */
function lastProps(): Record<string, unknown> {
  const calls = mockTrack.mock.calls
  return (calls[calls.length - 1]?.[0] as { properties: Record<string, unknown> }).properties
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTrack.mockResolvedValue(undefined)
  mockSubmit.mockResolvedValue({ ok: true, submitted: 1 })
  mockGetSitemapUrls.mockResolvedValue([A, B])
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ properties: { urls: [A, B] } })
})

it('submits nothing when no URL is new', async () => {
  const out = await runIndexNowDelta()
  expect(out.status).toBe('nothing-new')
  expect(mockSubmit).not.toHaveBeenCalled()
})

it('submits only the URLs that appeared since last run', async () => {
  mockGetSitemapUrls.mockResolvedValue([A, B, C])
  const out = await runIndexNowDelta()
  expect(out.newUrls).toBe(1)
  expect(mockSubmit).toHaveBeenCalledWith([C])
})

it('records a baseline on the first ever run and submits nothing', async () => {
  // Otherwise a cold start looks like "every page is brand new" and fires a
  // full push disguised as a delta — the exact thing this avoids.
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue(null)
  const out = await runIndexNowDelta()
  expect(out.status).toBe('baseline')
  expect(mockSubmit).not.toHaveBeenCalled()
  expect(lastProps()).toMatchObject({ status: 'baseline' })
})

it('does not advance the baseline when the submission is rejected', async () => {
  // Recording the URLs as seen after a rejection would drop them forever.
  mockGetSitemapUrls.mockResolvedValue([A, B, C])
  mockSubmit.mockResolvedValue({ ok: false, submitted: 0 })
  await runIndexNowDelta()
  const props = lastProps()
  expect(props.status).toBe('rejected')
  expect(props.urls).toBeUndefined()
})

it('advances the baseline when the submission is accepted', async () => {
  mockGetSitemapUrls.mockResolvedValue([A, B, C])
  await runIndexNowDelta()
  expect(lastProps()).toMatchObject({ status: 'submitted', accepted: true })
  expect((lastProps().urls as string[]).length).toBe(3)
})

it('treats an empty sitemap as a fault, not as "everything was deleted"', async () => {
  mockGetSitemapUrls.mockResolvedValue([])
  const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const out = await runIndexNowDelta()
  quiet.mockRestore()
  expect(out.status).toBe('error')
  expect(mockTrack).not.toHaveBeenCalled()
  expect(mockSubmit).not.toHaveBeenCalled()
})

it('survives a sitemap fetch failure without touching the baseline', async () => {
  mockGetSitemapUrls.mockRejectedValue(new Error('timeout'))
  const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const out = await runIndexNowDelta()
  quiet.mockRestore()
  expect(out.status).toBe('error')
  expect(mockTrack).not.toHaveBeenCalled()
})

it('caps one submission so a corpus jump cannot fire an unbounded push', async () => {
  const many = Array.from({ length: 900 }, (_, i) => `https://resumeai-bot.com/p${i}`)
  mockGetSitemapUrls.mockResolvedValue(many)
  const out = await runIndexNowDelta()
  expect(out.newUrls).toBe(500)
  expect(mockSubmit.mock.calls[0][0]).toHaveLength(500)
})

it('ignores a removed URL — deletions are not an IndexNow event', async () => {
  mockPrisma.analyticsEvent.findFirst.mockResolvedValue({ properties: { urls: [A, B, C] } })
  mockGetSitemapUrls.mockResolvedValue([A, B])
  const out = await runIndexNowDelta()
  expect(out.status).toBe('nothing-new')
  expect(mockSubmit).not.toHaveBeenCalled()
})
