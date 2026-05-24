/**
 * lib/experiments.ts
 *
 * In-house A/B experiment assignment.
 * Stage 1 — zero external deps, all data in Postgres.
 *
 * Design:
 * - Logged-in users: assigned by userId (sticky forever in ExperimentAssignment)
 * - Anonymous visitors: assigned by anonId from `rai_anon` cookie
 *   (cookie is seeded by middleware.ts before this runs)
 * - Variant assignment uses deterministic SHA-256 bucketing — same input → same output
 * - Inactive/missing experiments always return 'control'
 *
 * Conversion tracking convention:
 *   Include `experiment_key` and `variant` in `properties` when calling trackEvent():
 *   await trackEvent({ event: 'checkout_started', userId, properties: { experiment_key, variant } })
 *
 * Server-side only (uses next/headers).
 */

import { prisma } from './prisma'
import { cookies } from 'next/headers'
import crypto from 'crypto'

export const ANON_COOKIE = 'rai_anon'

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get or assign a variant for the given experiment.
 *
 * Returns 'control' when:
 *  - experiment doesn't exist in DB
 *  - experiment is inactive (active = false)
 *  - no stable identity available (no userId, no anonId cookie)
 */
export async function getOrAssignVariant(
  experimentKey: string,
  userId?: string,
): Promise<string> {
  const exp = await prisma.experiment.findUnique({ where: { key: experimentKey } })
  if (!exp || !exp.active) return 'control'

  // Prefer userId; fall back to anonId from cookie
  const cookieStore = await cookies()
  const anonId = cookieStore.get(ANON_COOKIE)?.value
  const stableId = userId ?? anonId

  if (!stableId) return 'control'

  // Check for an existing assignment (upsert would cause duplicate key on concurrent requests)
  const existing = await prisma.experimentAssignment.findFirst({
    where: {
      experimentKey,
      ...(userId ? { userId } : { anonId: stableId }),
    },
  })
  if (existing) return existing.variant

  return _assignAndSave(exp, userId, userId ? undefined : stableId)
}

/**
 * Look up the assigned variant without creating a new one.
 * Useful for analytics reads where you don't want side-effects.
 */
export async function getAssignedVariant(
  experimentKey: string,
  userId?: string,
): Promise<string | null> {
  const cookieStore = await cookies()
  const anonId = cookieStore.get(ANON_COOKIE)?.value
  const existing = await prisma.experimentAssignment.findFirst({
    where: {
      experimentKey,
      ...(userId ? { userId } : { anonId }),
    },
  })
  return existing?.variant ?? null
}

/**
 * Get per-variant assignment counts for all active experiments — admin UI.
 */
export async function getExperimentStats() {
  const experiments = await prisma.experiment.findMany({ orderBy: { startedAt: 'desc' } })
  const stats = await Promise.all(
    experiments.map(async (exp) => {
      const counts = await prisma.experimentAssignment.groupBy({
        by: ['variant'],
        where: { experimentKey: exp.key },
        _count: { variant: true },
      })
      return {
        experiment: exp,
        variantCounts: Object.fromEntries(counts.map((c) => [c.variant, c._count.variant])),
        total: counts.reduce((s, c) => s + c._count.variant, 0),
      }
    }),
  )
  return stats
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function _assignAndSave(
  exp: { key: string; variants: string[]; weights: number[] },
  userId?: string,
  anonId?: string,
): Promise<string> {
  const variants = exp.variants
  const weights = exp.weights
  const total = weights.reduce((a, b) => a + b, 0)
  const seed = userId ?? anonId ?? crypto.randomUUID()

  const bucket =
    parseInt(
      crypto.createHash('sha256').update(`${exp.key}:${seed}`).digest('hex').slice(0, 8),
      16,
    ) % total

  let acc = 0
  let variant = variants[0]
  for (let i = 0; i < variants.length; i++) {
    acc += weights[i]
    if (bucket < acc) {
      variant = variants[i]
      break
    }
  }

  try {
    await prisma.experimentAssignment.create({
      data: { experimentKey: exp.key, userId, anonId, variant },
    })
  } catch {
    // Race condition: another request created the row first — fetch the winner
    const race = await prisma.experimentAssignment.findFirst({
      where: { experimentKey: exp.key, ...(userId ? { userId } : { anonId }) },
    })
    if (race) return race.variant
  }

  return variant
}
