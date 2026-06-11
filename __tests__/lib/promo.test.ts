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
