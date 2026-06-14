/**
 * Tests for lib/scheduling.ts — fair-share ordering + capacity model.
 */
import {
  interleaveByUser,
  appliesPerRun,
  estimateDailyCapacity,
  isDeliverable,
  type CapacityModel,
} from '@/lib/scheduling'

type C = { id: string; user: string }
const mk = (s: string): C[] => s.split(' ').map((x) => ({ id: x, user: x[0] }))

describe('interleaveByUser', () => {
  it('round-robins users so no user monopolizes the front of the queue', () => {
    // user A has 3 campaigns, B has 1, C has 1
    const out = interleaveByUser(mk('A1 A2 A3 B1 C1'), (c) => c.user).map((c) => c.id)
    // first pass takes one from each user in first-seen order
    expect(out.slice(0, 3)).toEqual(['A1', 'B1', 'C1'])
    // then A's remaining
    expect(out).toEqual(['A1', 'B1', 'C1', 'A2', 'A3'])
  })

  it('preserves each user\'s relative order', () => {
    const out = interleaveByUser(mk('A1 A2 B1 A3'), (c) => c.user).map((c) => c.id)
    const aOnly = out.filter((x) => x.startsWith('A'))
    expect(aOnly).toEqual(['A1', 'A2', 'A3'])
  })

  it('handles empty + single-user inputs', () => {
    expect(interleaveByUser([], (c: C) => c.user)).toEqual([])
    const single = interleaveByUser(mk('A1 A2 A3'), (c) => c.user).map((c) => c.id)
    expect(single).toEqual(['A1', 'A2', 'A3'])
  })

  it('does not drop or duplicate items', () => {
    const input = mk('A1 B1 B2 C1 C2 C3 A2')
    const out = interleaveByUser(input, (c) => c.user)
    expect(out).toHaveLength(input.length)
    expect(new Set(out.map((c) => c.id)).size).toBe(input.length)
  })
})

describe('capacity model', () => {
  const base: CapacityModel = { runsPerDay: 48, concurrency: 2, runBudgetMs: 1_200_000, avgApplyMs: 45_000 }

  it('appliesPerRun = concurrency * budget / avgApplyMs (floored)', () => {
    // 2 * 1_200_000 / 45_000 = 53.3 → 53
    expect(appliesPerRun(base)).toBe(53)
  })

  it('estimateDailyCapacity = appliesPerRun * runsPerDay', () => {
    expect(estimateDailyCapacity(base)).toBe(53 * 48)
  })

  it('concurrency 1 roughly halves capacity', () => {
    expect(estimateDailyCapacity({ ...base, concurrency: 1 })).toBe(26 * 48)
  })

  it('isDeliverable compares capacity vs demand with headroom ratio', () => {
    const d = isDeliverable(250, base) // 10 Pro users at 25/day
    expect(d.deliverable).toBe(true)
    expect(d.capacity).toBe(53 * 48)
    expect(d.ratio).toBeGreaterThan(1)
  })

  it('flags undeliverable demand', () => {
    const tiny: CapacityModel = { runsPerDay: 12, concurrency: 1, runBudgetMs: 1_200_000, avgApplyMs: 100_000 }
    // 1 * 1_200_000/100_000 = 12 per run * 12 = 144/day
    expect(estimateDailyCapacity(tiny)).toBe(144)
    expect(isDeliverable(500, tiny).deliverable).toBe(false)
  })

  it('avgApplyMs <= 0 yields zero (no divide-by-zero)', () => {
    expect(appliesPerRun({ ...base, avgApplyMs: 0 })).toBe(0)
  })
})
