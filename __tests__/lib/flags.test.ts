/**
 * Tests for lib/flags.ts
 *
 * All tests run without a DB — we mock the prisma client.
 */

import { isFlagEnabled, invalidateFlagCache } from '@/lib/flags'

// ── Mock Prisma ──────────────────────────────────────────────────────────────
jest.mock('@/lib/prisma', () => ({
  prisma: {
    featureFlag: {
      findMany: jest.fn(),
    },
  },
}))

const { prisma } = require('@/lib/prisma')

function mockFlags(rows: { key: string; enabled: boolean; rolloutPct: number }[]) {
  ;(prisma.featureFlag.findMany as jest.Mock).mockResolvedValue(rows)
  invalidateFlagCache() // ensure next call re-loads
}

describe('isFlagEnabled', () => {
  beforeEach(() => {
    invalidateFlagCache()
    jest.clearAllMocks()
  })

  it('returns false when flag is absent', async () => {
    mockFlags([])
    expect(await isFlagEnabled('missing_flag', 'user1')).toBe(false)
  })

  it('returns false when flag is disabled', async () => {
    mockFlags([{ key: 'my_flag', enabled: false, rolloutPct: 100 }])
    expect(await isFlagEnabled('my_flag', 'user1')).toBe(false)
  })

  it('returns true when flag is enabled at 100%', async () => {
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 100 }])
    expect(await isFlagEnabled('my_flag', 'user1')).toBe(true)
  })

  it('returns false when flag is enabled at 0%', async () => {
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 0 }])
    expect(await isFlagEnabled('my_flag', 'user1')).toBe(false)
  })

  it('returns false for anonymous users on partial rollout', async () => {
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 50 }])
    expect(await isFlagEnabled('my_flag', undefined)).toBe(false)
  })

  it('returns deterministic result for the same (key, userId)', async () => {
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 50 }])
    const first  = await isFlagEnabled('my_flag', 'stable-user-id')
    invalidateFlagCache()
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 50 }])
    const second = await isFlagEnabled('my_flag', 'stable-user-id')
    expect(first).toBe(second)
  })

  it('produces ~50% true across a large synthetic userId set (±2% tolerance)', async () => {
    mockFlags([{ key: 'rollout_test', enabled: true, rolloutPct: 50 }])

    const N = 10_000
    let trueCount = 0
    for (let i = 0; i < N; i++) {
      // Each call hits the in-memory cache — only one DB call total
      if (await isFlagEnabled('rollout_test', `synth-user-${i}`)) trueCount++
    }

    const ratio = trueCount / N
    expect(ratio).toBeGreaterThan(0.48)
    expect(ratio).toBeLessThan(0.52)
  }, 15_000) // allow 15s for 10k iterations

  it('different userIds can get different values at 50% rollout', async () => {
    mockFlags([{ key: 'my_flag', enabled: true, rolloutPct: 50 }])
    const results = await Promise.all(
      ['user-a', 'user-b', 'user-c', 'user-d', 'user-e', 'user-f'].map((id) =>
        isFlagEnabled('my_flag', id),
      ),
    )
    // With 6 users at 50%, we expect at least some true AND some false
    expect(results.some(Boolean)).toBe(true)
    expect(results.some((v) => !v)).toBe(true)
  })

  it('uses cache — DB only called once per TTL window', async () => {
    mockFlags([{ key: 'cached_flag', enabled: true, rolloutPct: 100 }])
    await isFlagEnabled('cached_flag', 'u1')
    await isFlagEnabled('cached_flag', 'u2')
    await isFlagEnabled('cached_flag', 'u3')
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(1)
  })

  it('reloads after invalidateFlagCache()', async () => {
    mockFlags([{ key: 'toggle', enabled: true, rolloutPct: 100 }])
    await isFlagEnabled('toggle', 'u1') // loads cache

    invalidateFlagCache()
    mockFlags([{ key: 'toggle', enabled: false, rolloutPct: 0 }])
    const result = await isFlagEnabled('toggle', 'u1')

    expect(result).toBe(false)
    expect(prisma.featureFlag.findMany).toHaveBeenCalledTimes(2)
  })
})
