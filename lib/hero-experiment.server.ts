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
import { HERO_FLAG, type HeroExperiment } from '@/lib/hero-experiment'

/**
 * Whether the hero test is live, and at what rollout.
 *
 * Deduped per request by cache() and refreshed on the page's ISR interval. A
 * database error returns "off" — a landing page must render when the DB is
 * unhappy, and the control copy is the safe default.
 */
export const getHeroExperiment = cache(async (): Promise<HeroExperiment> => {
  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key: HERO_FLAG },
      select: { enabled: true, rolloutPct: true },
    })
    if (!flag?.enabled) return { active: false, pct: 0 }
    const pct = Math.max(0, Math.min(100, flag.rolloutPct))
    // 0% and 100% are both "everyone sees one thing" — no need to run the
    // client-side split, and no exposure events worth recording.
    return { active: pct > 0 && pct < 100, pct }
  } catch {
    return { active: false, pct: 0 }
  }
})
