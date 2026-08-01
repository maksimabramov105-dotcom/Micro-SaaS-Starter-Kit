import { isPromoActive, promoEndLabel, type Promo } from '@/lib/promo'

const PAST: Promo = { code: 'X', discountLabel: 'y', endsAt: '2020-01-01T00:00:00Z' }
const FUTURE: Promo = { code: 'X', discountLabel: 'y', endsAt: '2999-01-01T00:00:00Z' }
const BAD: Promo = { code: 'X', discountLabel: 'y', endsAt: 'not-a-date' }

describe('isPromoActive', () => {
  it('is false once the end date has passed (no expired countdown ever renders)', () => {
    expect(isPromoActive(new Date(), PAST)).toBe(false)
    expect(isPromoActive(new Date('2020-01-02T00:00:00Z'), PAST)).toBe(false)
  })

  it('is true while the promo is still running', () => {
    expect(isPromoActive(new Date(), FUTURE)).toBe(true)
  })

  it('is false exactly at the end instant (strictly before)', () => {
    const at = new Date('2020-01-01T00:00:00Z')
    expect(isPromoActive(at, PAST)).toBe(false)
  })

  it('is false for an unparseable end date (fails safe — hidden)', () => {
    expect(isPromoActive(new Date(), BAD)).toBe(false)
  })
})

describe('promoEndLabel', () => {
  it('formats the configured date, never a hardcoded string', () => {
    expect(promoEndLabel(FUTURE)).toMatch(/January 1/)
  })
  it('returns empty for an invalid date', () => {
    expect(promoEndLabel(BAD)).toBe('')
  })
})

describe('promoEndLabel is timezone-stable', () => {
  // Found on the live pricing page: the banner read "Ends September 2" directly
  // above body copy reading "(ends September 1)". Same promo, same page, same
  // function — but the banner renders on the CLIENT and the copy on the SERVER,
  // and with no timeZone the label followed each runtime's zone. endsAt is
  // 23:59:59Z, so an hour of offset flips the date.
  const LATE: Promo = {
    code: 'X', discountLabel: '40% off', endsAt: '2026-09-01T23:59:59Z',
  } as Promo

  const withTz = (tz: string) => {
    const prev = process.env.TZ
    process.env.TZ = tz
    try {
      return promoEndLabel(LATE)
    } finally {
      process.env.TZ = prev
    }
  }

  it('reads the same regardless of the runtime timezone', () => {
    const labels = ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Europe/Berlin'].map(withTz)
    expect(new Set(labels).size).toBe(1)
  })

  it('reports the UTC date the promo actually ends on', () => {
    expect(promoEndLabel(LATE)).toBe('September 1')
  })

  it('still returns empty for an unparseable date', () => {
    expect(promoEndLabel({ code: 'X', discountLabel: 'y', endsAt: 'nonsense' } as Promo)).toBe('')
  })
})
