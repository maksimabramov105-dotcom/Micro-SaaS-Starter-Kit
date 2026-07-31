/**
 * Landing hero A/B (P5.7).
 *
 * The scripts are strings, so the tests treat them as strings — and the things
 * worth asserting are the ones that would silently ruin the experiment or the
 * page rather than fail loudly:
 *
 *   - nothing at all is emitted when the test is off (no stray cookie, no
 *     beacon, no dead script on a page that is not experimenting)
 *   - the bucketing threshold matches the rollout percentage
 *   - the swap is keyed to ids that actually exist in the hero markup
 *   - variant copy is JSON-encoded, so an apostrophe cannot break the page
 *
 * Plus an execution test for the bucketing itself, because "same visitor always
 * sees the same headline" is the one property a copy test cannot do without.
 */
import { render } from '@testing-library/react'
import { HeroVariantScript, HeroExposure } from '@/components/hero-experiment'
import { HERO_B, HERO_COOKIE, HERO_EXPERIMENT } from '@/lib/hero-experiment'

const OFF = { active: false, pct: 0 }
const ON = { active: true, pct: 50 }

function scriptText(ui: React.ReactElement): string {
  const { container } = render(ui)
  return container.querySelector('script')?.innerHTML ?? ''
}

describe('when the experiment is off', () => {
  it('emits no variant script', () => {
    const { container } = render(<HeroVariantScript experiment={OFF} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('emits no exposure beacon', () => {
    const { container } = render(<HeroExposure experiment={OFF} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('variant script', () => {
  it('buckets against the configured rollout percentage', () => {
    expect(scriptText(<HeroVariantScript experiment={{ active: true, pct: 30 }} />)).toContain(
      '%100)<30',
    )
  })

  it('targets the ids the hero actually uses', () => {
    const s = scriptText(<HeroVariantScript experiment={ON} />)
    expect(s).toContain("getElementById('hero-headline')")
    expect(s).toContain("getElementById('hero-subhead')")
  })

  it('writes the variant cookie so conversions can be attributed', () => {
    expect(scriptText(<HeroVariantScript experiment={ON} />)).toContain(`${HERO_COOKIE}=`)
  })

  it('JSON-encodes the copy — an apostrophe must not be able to break the page', () => {
    const s = scriptText(<HeroVariantScript experiment={ON} />)
    expect(s).toContain(JSON.stringify(HERO_B.headline))
  })
})

describe('exposure beacon', () => {
  it('tags the event with the experiment key and variant', () => {
    const s = scriptText(<HeroExposure experiment={ON} />)
    expect(s).toContain(`experiment_key:'${HERO_EXPERIMENT}'`)
    expect(s).toContain('experiment_exposure')
  })

  it('deduplicates per browser so the denominator is not inflated', () => {
    expect(scriptText(<HeroExposure experiment={ON} />)).toContain('localStorage.setItem(K,v)')
  })
})

describe('bucketing behaviour', () => {
  /** Run the emitted script against a fake DOM and report the chosen variant. */
  function assign(pct: number, id: string): string {
    document.body.innerHTML =
      '<h1 id="hero-headline">control</h1><p id="hero-subhead">control sub</p>'
    localStorage.setItem('rai_ab_id', id)
    eval(scriptText(<HeroVariantScript experiment={{ active: true, pct }} />))
    return (window as unknown as { __raiHero: string }).__raiHero
  }

  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
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

  it('survives localStorage being unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    document.body.innerHTML = '<h1 id="hero-headline">control</h1>'
    expect(() => eval(scriptText(<HeroVariantScript experiment={ON} />))).not.toThrow()
    spy.mockRestore()
  })
})
