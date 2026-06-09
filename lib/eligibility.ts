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

export type KnockoutReason = 'remote_only' | 'work_auth'

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
    const last = segs[segs.length - 1]
    country = last && last.length >= 3 ? last : null
  }
  return { country, isRemote }
}

/**
 * Pre-apply gate. Returns a reason to SKIP (and log), or null when the apply is
 * worth attempting. Remote roles always pass the work-auth gate.
 */
export function eligibilityKnockout(
  profile: EligibilityProfile,
  job: { country: string | null; isRemote: boolean },
): KnockoutReason | null {
  if (job.isRemote) return null
  if (profile.remoteOnly) return 'remote_only'
  const jc = normalizeCountry(job.country ?? '')
  if (!jc) return null // unknown on-site location — don't skip on uncertainty
  const authorized = new Set(profile.authorizedCountries.map(normalizeCountry))
  if (authorized.has(jc)) return null
  // Relocating still requires the right to work; only eligible if willing to
  // relocate AND no sponsorship needed (e.g. qualifying citizenship).
  if (profile.willingToRelocate && !profile.needsVisaSponsorship) return null
  return 'work_auth'
}
