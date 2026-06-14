/**
 * lib/eligibility.ts
 *
 * Phase 1: the pre-apply eligibility gate used by the campaign runner.
 *
 * Mirrors worker/worker/autoapply/eligibility.py (the worker uses the same
 * facts to answer screening questions honestly). Here we decide, BEFORE calling
 * the worker, whether the candidate could actually win the role — so on-site
 * jobs they can't work get skipped + logged instead of burning quota.
 */

export interface EligibilityProfile {
  authorizedCountries: string[]
  needsVisaSponsorship: boolean
  willingToRelocate: boolean
  remoteOnly: boolean
  languages: string[]
}

export type KnockoutReason =
  | 'remote_only'
  | 'work_auth'
  | 'remote_region'
  | 'seniority_mismatch'

// Common spellings/abbreviations → a normalized comparison key.
const COUNTRY_ALIASES: Record<string, string> = {
  us: 'united states',
  usa: 'united states',
  'u.s.': 'united states',
  'u.s.a.': 'united states',
  'united states of america': 'united states',
  america: 'united states',
  uk: 'united kingdom',
  'u.k.': 'united kingdom',
  nz: 'new zealand',
  aus: 'australia',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  uae: 'united arab emirates',
  deutschland: 'germany',
}

// US state abbreviations (+ DC) — used to recognise US on-site locations like
// "San Francisco, CA" or "Austin, TX".
const US_STATES = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il',
  'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt',
  'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
])

export function normalizeCountry(value: string): string {
  if (!value) return ''
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ')
  return COUNTRY_ALIASES[v] ?? v
}

function looksUS(location: string): boolean {
  const l = location.toLowerCase()
  if (/\b(united states|u\.?s\.?a?\.?|america)\b/.test(l)) return true
  for (const seg of l.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (US_STATES.has(seg)) return true
    const firstTok = seg.split(/\s+/)[0]
    if (US_STATES.has(firstTok)) return true
  }
  return false
}

// Major hiring cities → country. Lets us understand a location that names only
// a city (e.g. a candidate who types "Sydney" or a job posted as "Berlin"),
// which is extremely common. Used for BOTH candidate-residency inference and
// job-location detection, so it benefits every user, not just one region.
const CITY_TO_COUNTRY: Record<string, string> = {
  // United States
  'new york': 'united states', 'san francisco': 'united states', 'los angeles': 'united states',
  seattle: 'united states', austin: 'united states', boston: 'united states', chicago: 'united states',
  denver: 'united states', atlanta: 'united states', miami: 'united states', dallas: 'united states',
  'san diego': 'united states', portland: 'united states', 'washington': 'united states',
  // United Kingdom
  london: 'united kingdom', manchester: 'united kingdom', edinburgh: 'united kingdom',
  bristol: 'united kingdom', cambridge: 'united kingdom',
  // Germany
  berlin: 'germany', munich: 'germany', münchen: 'germany', hamburg: 'germany', frankfurt: 'germany', cologne: 'germany',
  // France / NL / ES / IE / PL / PT
  paris: 'france', lyon: 'france', amsterdam: 'netherlands', rotterdam: 'netherlands',
  madrid: 'spain', barcelona: 'spain', dublin: 'ireland', warsaw: 'poland', krakow: 'poland', 'kraków': 'poland',
  lisbon: 'portugal', porto: 'portugal',
  // Canada
  toronto: 'canada', vancouver: 'canada', montreal: 'canada', ottawa: 'canada', calgary: 'canada',
  // Australia / NZ
  sydney: 'australia', melbourne: 'australia', brisbane: 'australia', perth: 'australia',
  adelaide: 'australia', canberra: 'australia',
  auckland: 'new zealand', wellington: 'new zealand', christchurch: 'new zealand',
  // India / APAC / LATAM
  bangalore: 'india', bengaluru: 'india', mumbai: 'india', delhi: 'india', hyderabad: 'india',
  pune: 'india', chennai: 'india', 'sao paulo': 'brazil', 'são paulo': 'brazil',
  'rio de janeiro': 'brazil', 'mexico city': 'mexico',
}

// Tokens that are NOT a country — stop "Remote"/"Anywhere"/etc. from being
// mistaken for a country by the last-segment fallback.
const NON_COUNTRY_TOKENS = new Set([
  'remote', 'anywhere', 'worldwide', 'world wide', 'distributed', 'wfh', 'global',
  'hybrid', 'onsite', 'on-site', 'on site', 'flexible', 'various', 'multiple locations',
  'work from home', 'home based', 'home-based', 'eu', 'emea', 'apac', 'latam', 'europe', 'anz',
])

/**
 * Best-effort inference of a job's country + remote-ness from its free-text
 * location (and title as a hint). Country is returned normalized (lowercase),
 * or null when it cannot be determined confidently.
 */
export function inferJobLocation(
  location: string,
  title = '',
): { country: string | null; isRemote: boolean } {
  const loc = (location || '').trim()
  const hay = `${loc} ${title}`.toLowerCase()
  // Recognise the common ways a remote role is described — not just "remote".
  const REMOTE_SIGNALS = /\b(remote|anywhere|worldwide|world ?wide|distributed|wfh|work from home|fully ?remote|remote[- ]first|home[- ]based|global)\b/
  const isRemote = REMOTE_SIGNALS.test(hay) && !/\bhybrid\b/.test(hay)

  let country: string | null = null
  if (looksUS(loc)) {
    country = 'united states'
  } else {
    const segs = loc.split(',').map((s) => normalizeCountry(s)).filter(Boolean)
    // 1. Prefer a recognised major city in any segment. Handles "Sydney",
    //    "Melbourne, VIC", "Toronto, ON", "New York" — so a city-only location
    //    resolves and sub-national abbreviations (VIC/ON/NSW) don't fool us.
    for (const seg of segs) {
      if (CITY_TO_COUNTRY[seg]) { country = CITY_TO_COUNTRY[seg]; break }
    }
    // 2. Otherwise fall back to an explicit country in the last segment
    //    (e.g. "Lagos, Nigeria"), ignoring non-country tokens like "Remote".
    if (!country) {
      const last = segs[segs.length - 1]
      if (last && last.length >= 3 && !NON_COUNTRY_TOKENS.has(last)) country = last
    }
  }
  return { country, isRemote }
}

// ── Hiring-region detection (Phase 2 / targeting_v2) ────────────────────────
// Most "remote" roles at US/EU companies only employ in specific countries
// (payroll/legal), so "remote" ≠ "eligible". We parse the job text for the
// region the company can actually hire in.
//
// Returns:
//   { global: true }                — hires anywhere (no restriction)
//   { countries: [...normalized] }  — restricted to these countries
//   null                            — NO region signal found (caller: don't skip)
export type HiringRegion = { global: true } | { countries: string[] } | null

const REGION_GROUPS: Record<string, string[]> = {
  emea: ['united kingdom', 'germany', 'france', 'spain', 'portugal', 'netherlands', 'ireland', 'poland', 'romania'],
  europe: ['united kingdom', 'germany', 'france', 'spain', 'portugal', 'netherlands', 'ireland', 'poland', 'romania'],
  eu: ['germany', 'france', 'spain', 'portugal', 'netherlands', 'ireland', 'poland', 'romania'],
  latam: ['brazil', 'mexico', 'argentina'],
  apac: ['australia', 'singapore', 'india', 'new zealand'],
  anz: ['australia', 'new zealand'],
}

export function detectHiringRegion(text: string): HiringRegion {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ')
  if (!t) return null

  // 1. Global / anywhere — no restriction.
  if (/\b(work from anywhere|anywhere in the world|worldwide|fully (global|distributed)|globally remote|remote[- ]?global|no location requirement)\b/.test(t)) {
    return { global: true }
  }

  // 2. Explicit US-only / US-authorization signals.
  // Includes "remote from/in/within the US", "US-based", and "(select states)"
  // — phrasings that mean US-only but previously slipped through as no-signal,
  // so we'd wrongly attempt them for non-US candidates.
  if (/\b(us only|u\.s\. only|usa only|united states only|us[- ]based|must be (located|based) in the (us|united states)|authorized to work in the (us|united states|u\.s\.?)|us work authorization|remote[, (–-]+(us|usa|united states)\b|remote (from|in|within)( the)? (us|u\.s\.?|usa|united states)\b|select states|based in (the )?(us|u\.s\.?|usa|united states)\b|\(us\b|\bus[- ]remote\b|remote within the (us|united states))\b/.test(t)) {
    return { countries: ['united states'] }
  }

  // 3. Country/region phrases like "remote (EMEA)", "Europe only", "remote - UK",
  //    "remote in Canada", "based in Germany".
  const regionHit = t.match(/\b(emea|europe|eu|latam|apac|anz)\b/)
  if (regionHit && /\b(remote|hire|based|located|within|only|region)\b/.test(t)) {
    return { countries: REGION_GROUPS[regionHit[1]] }
  }
  const countryHit = t.match(/\bremote[, (–-]+(canada|united kingdom|uk|germany|australia|new zealand|nz|india|ireland|france|netherlands|spain|brazil|mexico|singapore)\b/)
  if (countryHit) return { countries: [normalizeCountry(countryHit[1])] }

  // 4. US timezone constraints imply US/Americas hiring.
  if (/\b(est|edt|pst|pdt|cst|cdt|mst|mdt|et\b|pt\b|us timezone|north american (time|hours)|pacific time|eastern time)\b/.test(t)) {
    return { countries: ['united states', 'canada'] }
  }

  return null // no region signal — caller must not skip on uncertainty
}

// ── Seniority extraction (Phase 2 / targeting_v2) ───────────────────────────
// Numeric ladder so we can skip roles ≥2 levels from the candidate.
//   0 intern · 1 junior · 2 mid · 3 senior · 4 staff/lead/principal · 5 manager/director · 6 VP+
export function extractSeniority(title: string): number | null {
  const t = (title || '').toLowerCase()
  if (/\b(vp|vice president|head of|chief|c[teio]o)\b/.test(t)) return 6
  if (/\b(director|manager|mgr)\b/.test(t)) return 5
  if (/\b(staff|principal|lead|architect)\b/.test(t)) return 4
  if (/\b(senior|sr\.?|sr )\b/.test(t)) return 3
  if (/\b(junior|jr\.?|jr |entry[- ]level|associate i\b|associate\b)\b/.test(t)) return 1
  if (/\b(intern|internship|trainee|graduate|new grad)\b/.test(t)) return 0
  return 2 // default: mid-level when no explicit marker
}

/**
 * Pre-apply gate. Returns a reason to SKIP (and log), or null when worth applying.
 *
 * Legacy behavior (targetingV2 off): remote roles always pass the work-auth gate.
 * targeting_v2 adds, for REMOTE roles, a hiring-region check (remote_region) and,
 * for ALL roles, a seniority distance check (seniority_mismatch).
 */
export function eligibilityKnockout(
  profile: EligibilityProfile,
  job: { country: string | null; isRemote: boolean },
  opts?: { text?: string; targetingV2?: boolean; profileSeniority?: number | null },
): KnockoutReason | null {
  const v2 = opts?.targetingV2 === true
  const authorized = new Set(profile.authorizedCountries.map(normalizeCountry))
  const relocateEscape = profile.willingToRelocate && !profile.needsVisaSponsorship
  // No authorized countries on file = we don't know where the candidate can work.
  // Never skip on authorization grounds under uncertainty (the principle: apply
  // wherever the resume might be accepted; only skip when we KNOW it can't be).
  const unknownAuth = authorized.size === 0

  // Seniority distance (both remote + on-site). Skip roles ≥2 levels away.
  if (v2 && opts?.profileSeniority != null && opts?.text) {
    const jobLevel = extractSeniority(opts.text)
    if (jobLevel != null && Math.abs(jobLevel - opts.profileSeniority) >= 2) {
      return 'seniority_mismatch'
    }
  }

  if (job.isRemote) {
    // The remote-region gate is ALWAYS on — it is the #1 cause of wasted
    // applications (a "remote" role at a US company usually only employs in the
    // US/EU, so a non-US candidate is auto-knocked at screening). A remote role
    // passes ONLY when its detected hiring region is compatible with the
    // candidate's work eligibility. We deliberately DON'T skip on uncertainty:
    // unknown region, global hiring, or unknown candidate auth all pass, so we
    // never silently drop a winnable role.
    const region = detectHiringRegion(opts?.text ?? '')
    if (region === null) return null // no hiring-region signal — don't skip
    if ('global' in region) return null // hires anywhere
    if (unknownAuth || relocateEscape) return null // unknown auth → don't skip
    const overlap = region.countries.some((c) => authorized.has(normalizeCountry(c)))
    if (overlap) return null
    return 'remote_region'
  }

  if (profile.remoteOnly) return 'remote_only'
  const jc = normalizeCountry(job.country ?? '')
  if (!jc) return null // unknown on-site location — don't skip on uncertainty
  if (unknownAuth) return null // unknown auth → don't skip on-site either
  if (authorized.has(jc)) return null
  // Relocating still requires the right to work; only eligible if willing to
  // relocate AND no sponsorship needed (e.g. qualifying citizenship).
  if (relocateEscape) return null
  return 'work_auth'
}
