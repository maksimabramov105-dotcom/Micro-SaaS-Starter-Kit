/**
 * Traffic attribution for the weekly growth report (T4).
 *
 * The report already covered the funnel and the money. It could not answer the
 * first question you ask about a growth loop — where did the people come from,
 * and is search starting to work — so nothing about the SEO investment was
 * falsifiable.
 *
 * classifySource is pure and carries all the judgement, so it gets the most
 * attention here.
 */
const mockPrisma = { analyticsEvent: { findMany: jest.fn() } }
jest.mock('@/lib/prisma', () => ({ get prisma() { return mockPrisma } }))

import { classifySource, getTrafficSnapshot, formatTrafficBlock } from '@/lib/pmf/traffic'

describe('classifySource', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'organic'],
    ['https://duckduckgo.com/', 'organic'],
    ['https://www.bing.com/', 'organic'],
    ['android-app://com.google.android.googlequicksearchbox', 'organic'],
  ])('%s → %s', (ref, want) => {
    expect(classifySource(ref)).toBe(want)
  })

  it.each([
    ['https://www.reddit.com/r/jobs/', 'social'],
    ['https://news.ycombinator.com/item?id=1', 'social'],
    ['https://t.co/abc', 'social'],
    ['https://www.linkedin.com/feed/', 'social'],
  ])('%s → %s', (ref, want) => {
    expect(classifySource(ref)).toBe(want)
  })

  it('treats no referrer as direct', () => {
    expect(classifySource('')).toBe('direct')
    expect(classifySource(null)).toBe('direct')
    expect(classifySource(undefined)).toBe('direct')
  })

  it('does not count our own pages as referrals', () => {
    // Internal navigation would otherwise dwarf every real source.
    expect(classifySource('https://resumeai-bot.com/pricing')).toBe('direct')
  })

  it('falls back to referral for anything else', () => {
    expect(classifySource('https://someblog.dev/post')).toBe('referral')
  })

  it('survives a referrer that is not a URL', () => {
    expect(classifySource('not a url at all')).toBe('referral')
  })
})

describe('getTrafficSnapshot', () => {
  const visits = [
    { referrer: 'https://google.com/', page: '/', sessionId: 's1' },
    { referrer: 'https://google.com/', page: '/', sessionId: 's1' }, // same visitor
    { referrer: 'https://google.com/', page: '/', sessionId: 's2' },
    { referrer: '', page: '/pricing', sessionId: 's3' },
    { referrer: 'https://reddit.com/', page: '/ats-check', sessionId: 's4' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.analyticsEvent.findMany
      .mockResolvedValueOnce(visits)
      .mockResolvedValueOnce([{ sessionId: 's1' }])
      .mockResolvedValueOnce([])
  })

  it('counts unique visitors, not raw page views', async () => {
    // s1 fired two events. Counting events would flatter organic most.
    const t = await getTrafficSnapshot()
    expect(t.bySource.organic).toBe(2)
    expect(t.total).toBe(4)
  })

  it('separates direct, social and organic', async () => {
    const t = await getTrafficSnapshot()
    expect(t.bySource.direct).toBe(1)
    expect(t.bySource.social).toBe(1)
  })

  it('passes the sitemap size through as indexed pages', async () => {
    const t = await getTrafficSnapshot(7, 301)
    expect(t.indexedPages).toBe(301)
  })
})

describe('formatTrafficBlock', () => {
  const snap = {
    bySource: { organic: 40, social: 5, referral: 2, direct: 10 },
    total: 57,
    bestPage: { page: '/ats-check', visits: 20, converted: 9, rate: 0.45 },
    worstError: { page: '/old-link', count: 12 },
    indexedPages: 301,
  }

  it('shows a week-over-week arrow when there is a prior figure', () => {
    const prev = { ...snap, bySource: { ...snap.bySource, organic: 20 }, total: 37 }
    expect(formatTrafficBlock(snap, prev).join('\n')).toContain('+100% WoW')
  })

  it('omits the arrow rather than dividing by zero on a first run', () => {
    const prev = { ...snap, bySource: { ...snap.bySource, organic: 0 }, total: 0 }
    expect(formatTrafficBlock(snap, prev).join('\n')).not.toContain('Infinity')
  })

  it('always keeps a GSC row, labelled, rather than silently omitting it', () => {
    // A metric that quietly disappears is worse than one labelled missing. The
    // caller now supplies these lines (lib/seo/gsc.ts); the default stands in
    // when Search Console cannot be reached.
    expect(formatTrafficBlock(snap).join('\n')).toMatch(/GSC impressions\s+unavailable/)
  })

  it('renders the GSC lines the caller passes in', () => {
    const out = formatTrafficBlock(snap, undefined, [
      '  GSC impressions       1234 (+20% WoW)',
      '  GSC clicks            56',
    ]).join('\n')
    expect(out).toContain('1234 (+20% WoW)')
    expect(out).toContain('GSC clicks            56')
  })

  it('names the best-converting page and the worst error', () => {
    const out = formatTrafficBlock(snap).join('\n')
    expect(out).toContain('/ats-check')
    expect(out).toContain('/old-link')
  })
})
