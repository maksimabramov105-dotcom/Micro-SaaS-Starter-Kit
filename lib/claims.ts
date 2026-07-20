/**
 * lib/claims.ts — canonical, defensible marketing claims (E3).
 *
 * We used to say "50+ countries", which we cannot substantiate: we do not
 * operate in 50 countries, we submit to a curated set of ATS boards. What IS
 * true and checkable is the company list the apply engine actually runs
 * against (lib/seo/apply-companies.json) plus remote-first sourcing.
 *
 * Import these instead of writing a coverage claim by hand — the consistency
 * test bans the old phrasing from reappearing.
 */
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'

/** Rounded DOWN to the nearest ten so the number is never overstated. */
export const SUBMITTABLE_COMPANY_COUNT = Math.floor(APPLY_COMPANIES.length / 10) * 10

/** Regions where our curated ATS boards actually hire. */
export const COVERAGE_REGIONS = 'AU, NZ, US & EU'
export const COVERAGE_REGIONS_SHORT = 'AU/NZ/US/EU'

/** Full sentence-fragment form, e.g. "remote-first roles at 160+ companies we can actually submit to, across AU, NZ, US & EU". */
export const COVERAGE_CLAIM = `remote-first roles at ${SUBMITTABLE_COMPANY_COUNT}+ companies we can actually submit to, across ${COVERAGE_REGIONS}`

/** Compact form for meta descriptions and tight UI. */
export const COVERAGE_CLAIM_SHORT = `remote-first roles at ${SUBMITTABLE_COMPANY_COUNT}+ companies, ${COVERAGE_REGIONS_SHORT}`

/**
 * The ONLY guarantee wording we use. We never promise interviews — outcomes
 * depend on the market and the applicant, so an interview-linked refund
 * promise would be unsubstantiated (and an FTC risk).
 */
export const GUARANTEE = '30-day money-back guarantee, no questions asked'
