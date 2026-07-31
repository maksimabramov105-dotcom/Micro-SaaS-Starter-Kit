/**
 * lib/pricing-experiment.server.ts — is the pricing headline test running?
 *
 * Server-only, split from the constants for the same reason as the hero test:
 * the client half needs the copy without Prisma coming with it.
 */
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { toAbConfig, type AbConfig } from '@/lib/ab'
import { PRICING_FLAG } from '@/lib/pricing-experiment'

/** A database error returns "off" — /pricing must render when the DB is down. */
export const getPricingExperiment = cache(async (): Promise<AbConfig> => {
  try {
    return toAbConfig(
      await prisma.featureFlag.findUnique({
        where: { key: PRICING_FLAG },
        select: { enabled: true, rolloutPct: true },
      }),
    )
  } catch {
    return { active: false, pct: 0 }
  }
})
