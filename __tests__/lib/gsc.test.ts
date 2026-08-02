/**
 * @jest-environment node
 *
 * Search Console pull for the weekly report.
 *
 * This answers the one question referrer data cannot: is Google SHOWING these
 * pages. A page can collect impressions for weeks before anyone clicks, and
 * referrers only ever see clicks — so without this the report could not tell
 * "nobody is finding us" from "we are not in the index at all".
 *
 * Confirmed live on 2026-08-02: 0 impressions, 0 clicks over 28 days. That is
 * why the zero case gets its own explanatory line rather than being printed as
 * a neutral number.
 */
import fs from 'fs'
import path from 'path'
import { formatGscLines } from '@/lib/seo/gsc'

const win = (impressions: number, clicks: number, position: number | null = 12.3) => ({
  impressions,
  clicks,
  position,
  topQueries: [],
})

describe('formatGscLines', () => {
  it('distinguishes "no data" from a genuine zero', () => {
    // A missing key and "Google shows us nothing" need different responses.
    const unavailable = formatGscLines(null).join('\n')
    expect(unavailable).toMatch(/unavailable/i)
    expect(unavailable).not.toMatch(/^\s*GSC impressions\s+0/m)
  })

  it('explains what zero impressions actually means', () => {
    const out = formatGscLines({ current: win(0, 0, null), previous: null }).join('\n')
    expect(out).toMatch(/not being shown yet, not merely unclicked/)
  })

  it('does not add that warning once impressions exist', () => {
    const out = formatGscLines({ current: win(400, 12), previous: null }).join('\n')
    expect(out).not.toMatch(/not being shown yet/)
  })

  it('shows week-over-week movement', () => {
    const out = formatGscLines({ current: win(200, 10), previous: win(100, 5) }).join('\n')
    expect(out).toContain('+100% WoW')
  })

  it('omits the comparison rather than dividing by zero on a first run', () => {
    const out = formatGscLines({ current: win(50, 2), previous: win(0, 0, null) }).join('\n')
    expect(out).not.toMatch(/Infinity|NaN/)
  })

  it('reports position as n/a when nothing was shown', () => {
    expect(formatGscLines({ current: win(0, 0, null), previous: null }).join('\n')).toMatch(
      /avg position\s+n\/a/,
    )
  })

  it('lists the top queries when there are any', () => {
    const cur = { ...win(90, 3), topQueries: [{ query: 'ats resume checker', impressions: 40, clicks: 2 }] }
    expect(formatGscLines({ current: cur, previous: null }).join('\n')).toContain('ats resume checker')
  })
})

describe('deployment wiring', () => {
  const compose = fs.readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8')

  /** The body of one compose service, by name. */
  function service(name: string): string {
    const m = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|\\Z)`, 'm'))
    return m?.[1] ?? ''
  }

  it('mounts the key into web, and only web', () => {
    // First attempt put it on postgres, which would have silently produced
    // "unavailable" in the report forever with no error anywhere.
    expect(service('web')).toContain('gsc-key.json')
    expect(service('postgres')).not.toContain('gsc-key.json')
    expect(service('worker')).not.toContain('gsc-key.json')
  })

  it('sets GSC_KEY_PATH on web, and only web', () => {
    expect(service('web')).toContain('GSC_KEY_PATH')
    expect(service('postgres')).not.toContain('GSC_KEY_PATH')
  })

  it('mounts the key read-only', () => {
    expect(service('web')).toMatch(/gsc-key\.json:ro/)
  })

  it('never commits the key itself', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'gsc-key.json'))).toBe(false)
    const ignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    expect(ignore).toMatch(/gsc-key\.json/)
  })
})
