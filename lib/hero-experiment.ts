/**
 * lib/hero-experiment.ts — the landing hero A/B test (P5.7): keys and copy.
 *
 * Mechanics live in lib/ab.ts, which explains why these tests are assigned in
 * the browser rather than on the server. This file is only the definition: what
 * is being tested, and where the answer gets recorded.
 *
 * Deliberately free of any server import, so the client half can pull the copy
 * in without dragging Prisma behind it. The database read is next door in
 * hero-experiment.server.ts.
 */
import type { VariantSwaps } from '@/lib/ab'

/** Flag key in the FeatureFlag table — flip it in the admin UI. */
export const HERO_FLAG = 'landing_hero_b'

/** Experiment key recorded on every exposure and conversion event. */
export const HERO_EXPERIMENT = 'landing_hero'

/** Cookie the inline script writes; read server-side to attribute conversions. */
export const HERO_COOKIE = 'rai_hero'

/**
 * Variant B copy.
 *
 * The control leads with the artifact ("a resume built for the job you actually
 * want"). B leads with the thing nobody else in this market will say out loud:
 * that we only count an application when the employer's system confirms it.
 * That is the actual differentiator, and whether it sells better than the
 * artifact framing is exactly the sort of question a test should answer rather
 * than an argument.
 */
export const HERO_B = {
  headline: 'Every application here is confirmed by the employer. Or it does not count.',
  subhead:
    'Most tools tell you they applied. We show you the ATS confirmation, or we say it failed. Paste a job posting, get your resume rewritten for that exact role, and watch every submission land in one inbox — verified.',
} as const

/** Element ids in app/page.tsx that variant B rewrites. */
export const HERO_SWAPS: VariantSwaps = {
  'hero-headline': HERO_B.headline,
  'hero-subhead': HERO_B.subhead,
}
