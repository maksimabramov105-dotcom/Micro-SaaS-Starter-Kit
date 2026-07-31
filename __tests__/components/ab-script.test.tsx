/**
 * Client-assigned A/B tests (lib/ab.ts + components/ab-script.tsx).
 *
 * The scripts are strings, so some of these tests read them as strings — the
 * failures worth catching are the ones that would silently ruin an experiment
 * or the page rather than fail loudly:
 *
 *   - nothing at all is emitted when the test is off (no stray cookie, no
 *     beacon, no dead script on a page that is not experimenting)
 *   - the bucketing threshold matches the rollout percentage
 *   - copy is JSON-encoded, so an apostrophe cannot break the page
 *
 * The rest actually execute the emitted script against jsdom, because "the same
 * visitor always sees the same headline" is the one property a copy test cannot
 * do without, and a string assertion cannot prove it.
 *
 * Both live experiments are covered here: they are the same machinery with
 * different copy, and testing the machinery once is the reason it is shared.
 */
import { render } from '@testing-library/react'
import { VariantScript, ExposureBeacon } from '@/components/ab-script'
import { toAbConfig } from '@/lib/ab'
import { HERO_B, HERO_COOKIE, HERO_EXPERIMENT, HERO_SWAPS } from '@/lib/hero-experiment'
import {
  PRICING_B,
  PRICING_COOKIE,
  PRICING_EXPERIMENT,
  PRICING_SWAPS,
} from '@/lib/pricing-experiment'

const OFF = { active: false, pct: 0 }
const ON = { active: true, pct: 50 }

const hero = (config = ON) => (
  <VariantScript
    config={config}
    experimentKey={HERO_EXPERIMENT}
    cookieName={HERO_COOKIE}
    swaps={HERO_SWAPS}
  />
)

const pricing = (config = ON) => (
  <VariantScript
    config={config}
    experimentKey={PRICING_EXPERIMENT}
    cookieName={PRICING_COOKIE}
    swaps={PRICING_SWAPS}
  />
)

function scriptText(ui: React.ReactElement): string {
  const { container } = render(ui)
  return container.querySelector('script')?.innerHTML ?? ''
}

function variantOf(key: string): string {
  return (window as unknown as { __raiAb: Record<string, string> }).__raiAb[key]
}

describe('toAbConfig', () => {
  it('is off when the flag is missing or disabled', () => {
    expect(toAbConfig(null)).toEqual({ active: false, pct: 0 })
    expect(toAbConfig({ enabled: false, rolloutPct: 50 })).toEqual({ active: false, pct: 0 })
  })

  it('treats 0% and 100% as "not a split" — everyone sees one thing', () => {
    expect(toAbConfig({ enabled: true, rolloutPct: 0 }).active).toBe(false)
    expect(toAbConfig({ enabled: true, rolloutPct: 100 }).active).toBe(false)
  })

  it('clamps a nonsense percentage instead of trusting it', () => {
    expect(toAbConfig({ enabled: true, rolloutPct: 150 }).pct).toBe(100)
    expect(toAbConfig({ enabled: true, rolloutPct: -20 }).pct).toBe(0)
  })

  it('is on for a real split', () => {
    expect(toAbConfig({ enabled: true, rolloutPct: 50 })).toEqual({ active: true, pct: 50 })
  })
})

describe('when the experiment is off', () => {
  it('emits no variant script', () => {
    const { container } = render(hero(OFF))
    expect(container).toBeEmptyDOMElement()
  })

  it('emits no exposure beacon', () => {
    const { container } = render(
      <ExposureBeacon config={OFF} experimentKey={HERO_EXPERIMENT} page="/" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('variant script', () => {
  it('buckets against the configured rollout percentage', () => {
    expect(scriptText(hero({ active: true, pct: 30 }))).toContain('%100)<30')
  })

  it('writes the variant cookie so conversions can be attributed', () => {
    expect(scriptText(hero())).toContain(HERO_COOKIE)
  })

  it('JSON-encodes the copy — an apostrophe must not be able to break the page', () => {
    expect(scriptText(hero())).toContain(JSON.stringify(HERO_B.headline))
  })

  it('keys the bucket on the experiment, so two tests do not correlate', () => {
    expect(scriptText(hero())).toContain(JSON.stringify(HERO_EXPERIMENT))
  })
})

describe('exposure beacon', () => {
  const beacon = scriptText(
    <ExposureBeacon config={ON} experimentKey={HERO_EXPERIMENT} page="/" />,
  )

  it('tags the event with the experiment key', () => {
    expect(beacon).toContain(JSON.stringify(HERO_EXPERIMENT))
    expect(beacon).toContain('experiment_exposure')
  })

  it('deduplicates per browser so the denominator is not inflated', () => {
    expect(beacon).toContain('localStorage.setItem(K,v)')
  })
})

describe('bucketing behaviour', () => {
  const HERO_DOM = '<h1 id="hero-headline">control</h1><p id="hero-subhead">control sub</p>'

  /** Run the emitted script against a fake DOM and report the chosen variant. */
  function assign(pct: number, id: string): string {
    document.body.innerHTML = HERO_DOM
    localStorage.setItem('rai_ab_id', id)
    eval(scriptText(hero({ active: true, pct })))
    return variantOf(HERO_EXPERIMENT)
  }

  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    delete (window as unknown as { __raiAb?: unknown }).__raiAb
  })

  it('is stable — the same visitor always sees the same headline', () => {
    const first = assign(50, 'visitor-abc')
    for (let i = 0; i < 5; i++) expect(assign(50, 'visitor-abc')).toBe(first)
  })

  it('gives everyone the control at 0%', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(assign(0, id)).toBe('a')
  })

  it('gives everyone variant B at 100%', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(assign(100, id)).toBe('b')
  })

  it('splits roughly evenly at 50%', () => {
    let b = 0
    for (let i = 0; i < 400; i++) if (assign(50, `visitor-${i}`) === 'b') b++
    expect(b).toBeGreaterThan(140)
    expect(b).toBeLessThan(260)
  })

  it('replaces both hero nodes for variant B and neither for the control', () => {
    assign(100, 'x')
    expect(document.getElementById('hero-headline')!.textContent).toBe(HERO_B.headline)
    expect(document.getElementById('hero-subhead')!.textContent).toBe(HERO_B.subhead)

    assign(0, 'x')
    expect(document.getElementById('hero-headline')!.textContent).toBe('control')
  })

  it('rewrites the pricing headline for variant B', () => {
    document.body.innerHTML =
      '<h1 id="pricing-headline">control</h1><p id="pricing-subhead">control sub</p>'
    localStorage.setItem('rai_ab_id', 'x')
    eval(scriptText(pricing({ active: true, pct: 100 })))
    expect(document.getElementById('pricing-headline')!.textContent).toBe(PRICING_B.h1)
    expect(document.getElementById('pricing-subhead')!.textContent).toBe(PRICING_B.sub)
  })

  it('gives independent buckets to two experiments for the same visitor', () => {
    // A visitor landing in B on every test at once would make one test's result
    // a shadow of the other's.
    let differed = false
    for (let i = 0; i < 60 && !differed; i++) {
      document.body.innerHTML = HERO_DOM
      localStorage.setItem('rai_ab_id', `visitor-${i}`)
      eval(scriptText(hero()))
      eval(scriptText(pricing()))
      if (variantOf(HERO_EXPERIMENT) !== variantOf(PRICING_EXPERIMENT)) differed = true
    }
    expect(differed).toBe(true)
  })

  it('survives localStorage being unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    document.body.innerHTML = '<h1 id="hero-headline">control</h1>'
    expect(() => eval(scriptText(hero()))).not.toThrow()
    spy.mockRestore()
  })
})
