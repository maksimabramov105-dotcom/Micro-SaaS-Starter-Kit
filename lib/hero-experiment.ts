/**
 * lib/hero-experiment.ts — the landing hero A/B test (P5.7): keys and copy.
 *
 * Deliberately free of any server import. The client-side pieces in
 * components/hero-experiment.tsx need the copy and the cookie name, and pulling
 * React's cache() or the Prisma client in behind them would make every consumer
 * — including the tests — a server module. The database read lives next door in
 * hero-experiment.server.ts.
 *
 * WHY IT LOOKS LIKE THIS, AND NOT LIKE lib/experiments.ts
 *
 * The obvious implementation is getOrAssignVariant() in a server component. We
 * did that on /pricing and it cost us: reading cookies opts the route out of
 * static rendering, every visitor waits on a database round-trip before the
 * first byte, and the Lighthouse score fell to 72. On the homepage — the page
 * every SEO effort in this project points at — that trade is not worth making
 * for a copy test.
 *
 * So the work is split by what each side is actually good at:
 *
 *   SERVER  decides whether the test is running and at what percentage, read
 *           from the FeatureFlag table through React cache() + the page's
 *           existing ISR window. Same data as any other flag, same admin UI,
 *           no redeploy to change it — and no per-request work.
 *
 *           (cache(), NOT unstable_cache: deploy builds run with a dummy
 *           DATABASE_URL, and unstable_cache would freeze the empty result
 *           into the build output. That has bitten this codebase before.)
 *
 *   CLIENT  decides which visitor sees which variant, from a stable id in
 *           localStorage, in an inline script that runs before paint. No
 *           flicker, no layout shift, and the control copy is what sits in the
 *           HTML — so crawlers index one stable version of the page.
 *
 * The cookie the script sets is what makes the test decidable: server-side
 * conversion events read it and attach the variant, so a purchase can be traced
 * back to the headline that produced it.
 */

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

export interface HeroExperiment {
  active: boolean
  /** 0-100. The share of visitors who see variant B. */
  pct: number
}
