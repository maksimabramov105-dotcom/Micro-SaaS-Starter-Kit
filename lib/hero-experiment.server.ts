/**
 * lib/hero-experiment.server.ts — is the hero test running, and at what split?
 *
 * Server-only, and separate from the constants next door so the client half can
 * import the copy without dragging Prisma in behind it.
 *
 * cache(), NOT unstable_cache: deploy builds run with a dummy DATABASE_URL, and
 * unstable_cache would freeze the empty result into the build output. That has
 * bitten this codebase before. cache() dedupes within a render and the page's
 * own ISR window handles freshness.
 */
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { toAbConfig, type AbConfig } from '@/lib/ab'
import { HERO_FLAG } from '@/lib/hero-experiment'

/**
 * Whether the hero test is live, and at what rollout.
 *
 * Deduped per request by cache() and refreshed on the page's ISR interval. A
 * database error returns "off" — a landing page must render when the DB is
 * unhappy, and the control copy is the safe default.
 */
export const getHeroExperiment = cache(async (): Promise<AbConfig> => {
  try {
    return toAbConfig(
      await prisma.featureFlag.findUnique({
        where: { key: HERO_FLAG },
        select: { enabled: true, rolloutPct: true },
      }),
    )
  } catch {
    return { active: false, pct: 0 }
  }
})
