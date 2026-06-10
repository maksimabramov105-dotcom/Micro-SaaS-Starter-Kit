/**
 * Tests for the pre-apply eligibility gate (lib/eligibility.ts).
 * Mirrors the worker resolver (worker/.../eligibility.py).
 */
import {
  normalizeCountry,
  inferJobLocation,
  eligibilityKnockout,
  detectHiringRegion,
  extractSeniority,
  type EligibilityProfile,
} from '@/lib/eligibility'

const INTL: EligibilityProfile = {
  authorizedCountries: ['Germany'],
  needsVisaSponsorship: true,
  willingToRelocate: false,
  remoteOnly: false,
  languages: ['English', 'German'],
}
const US_AUTH: EligibilityProfile = {
  authorizedCountries: ['United States'],
  needsVisaSponsorship: false,
  willingToRelocate: false,
  remoteOnly: false,
  languages: ['English'],
}

describe('normalizeCountry', () => {
  it('canonicalizes US aliases', () => {
    expect(normalizeCountry('US')).toBe('united states')
    expect(normalizeCountry('USA')).toBe('united states')
    expect(normalizeCountry('  United States ')).toBe('united states')
  })
})

describe('inferJobLocation', () => {
  it('detects US from a state abbreviation', () => {
    expect(inferJobLocation('San Francisco, CA').country).toBe('united states')
    expect(inferJobLocation('Austin, TX, USA').country).toBe('united states')
  })

  it('detects remote', () => {
    expect(inferJobLocation('Remote').isRemote).toBe(true)
    expect(inferJobLocation('Remote - US').isRemote).toBe(true)
  })

  it('treats hybrid as not remote', () => {
    expect(inferJobLocation('Hybrid - New York, NY').isRemote).toBe(false)
  })

  it('parses a trailing country', () => {
    expect(inferJobLocation('Berlin, Germany').country).toBe('germany')
  })

  it('returns null country when unknown', () => {
    expect(inferJobLocation('').country).toBeNull()
  })
})

describe('eligibilityKnockout', () => {
  it('never knocks out remote roles', () => {
    expect(eligibilityKnockout(INTL, { country: 'united states', isRemote: true })).toBeNull()
  })

  it('skips on-site roles for a remote-only candidate', () => {
    const p = { ...INTL, remoteOnly: true }
    expect(eligibilityKnockout(p, { country: 'united states', isRemote: false })).toBe('remote_only')
  })

  it('knocks out US on-site for an unauthorized international candidate', () => {
    expect(eligibilityKnockout(INTL, { country: 'united states', isRemote: false })).toBe('work_auth')
  })

  it('allows on-site where the candidate is authorized', () => {
    expect(eligibilityKnockout(US_AUTH, { country: 'united states', isRemote: false })).toBeNull()
  })

  it('allows relocation when no sponsorship is needed', () => {
    const p: EligibilityProfile = {
      authorizedCountries: [], needsVisaSponsorship: false,
      willingToRelocate: true, remoteOnly: false, languages: [],
    }
    expect(eligibilityKnockout(p, { country: 'canada', isRemote: false })).toBeNull()
  })

  it('does not skip on unknown on-site location', () => {
    const p = { ...INTL, remoteOnly: false }
    expect(eligibilityKnockout(p, { country: null, isRemote: false })).toBeNull()
  })
})

// ── Phase 2 / targeting_v2 ──────────────────────────────────────────────────

describe('detectHiringRegion', () => {
  const us = (s: string) => detectHiringRegion(s)
  it('Remote — US only → united states', () => {
    expect(us('Remote — US only')).toEqual({ countries: ['united states'] })
  })
  it('Remote (US)', () => {
    expect(us('Customer Support — Remote (US)')).toEqual({ countries: ['united states'] })
  })
  it('US-remote', () => {
    expect(us('US-Remote Support Specialist')).toEqual({ countries: ['united states'] })
  })
  it('authorized to work in the United States', () => {
    expect(us('You must be authorized to work in the United States.')).toEqual({ countries: ['united states'] })
  })
  it('Remote (EMEA) → europe group', () => {
    const r = detectHiringRegion('Remote (EMEA)')
    expect(r && 'countries' in r && r.countries).toContain('germany')
  })
  it('Europe only', () => {
    const r = detectHiringRegion('Remote, Europe only')
    expect(r && 'countries' in r && r.countries).toContain('united kingdom')
  })
  it('Remote - UK', () => {
    expect(detectHiringRegion('Remote - UK')).toEqual({ countries: ['united kingdom'] })
  })
  it('Remote in Canada', () => {
    expect(detectHiringRegion('Remote, Canada')).toEqual({ countries: ['canada'] })
  })
  it('anywhere → global', () => {
    expect(detectHiringRegion('Work from anywhere in the world')).toEqual({ global: true })
  })
  it('worldwide → global', () => {
    expect(detectHiringRegion('Fully remote, worldwide')).toEqual({ global: true })
  })
  it('globally remote → global', () => {
    expect(detectHiringRegion('This role is globally remote')).toEqual({ global: true })
  })
  it('US timezone constraint → US/Canada', () => {
    const r = detectHiringRegion('Remote. Must work PST hours.')
    expect(r && 'countries' in r && r.countries).toContain('united states')
  })
  it('Eastern time → US/Canada', () => {
    const r = detectHiringRegion('Remote — overlap with Eastern Time required')
    expect(r && 'countries' in r && r.countries).toContain('united states')
  })
  it('plain Remote with no signal → null', () => {
    expect(detectHiringRegion('Remote')).toBeNull()
  })
  it('APAC remote → australia group', () => {
    const r = detectHiringRegion('Remote (APAC)')
    expect(r && 'countries' in r && r.countries).toContain('australia')
  })
  it('empty → null', () => {
    expect(detectHiringRegion('')).toBeNull()
  })
})

describe('extractSeniority', () => {
  it('intern=0', () => expect(extractSeniority('Marketing Intern')).toBe(0))
  it('junior=1', () => expect(extractSeniority('Junior Support Agent')).toBe(1))
  it('mid (no marker)=2', () => expect(extractSeniority('Customer Support Specialist')).toBe(2))
  it('senior=3', () => expect(extractSeniority('Senior Customer Support')).toBe(3))
  it('staff/lead=4', () => expect(extractSeniority('Staff Engineer')).toBe(4))
  it('manager=5', () => expect(extractSeniority('Manager, Customer Support')).toBe(5))
  it('director=5', () => expect(extractSeniority('Director of Support')).toBe(5))
  it('VP=6', () => expect(extractSeniority('VP of Customer Experience')).toBe(6))
})

describe('eligibilityKnockout — targeting_v2', () => {
  // Honest international profile: authorized only in Australia, needs US sponsorship.
  const AU: EligibilityProfile = {
    authorizedCountries: ['Australia'], needsVisaSponsorship: true,
    willingToRelocate: false, remoteOnly: false, languages: ['English'],
  }
  const v2 = (text: string, p = AU, isRemote = true, profileSeniority: number | null = null) =>
    eligibilityKnockout(p, { country: null, isRemote }, { text, targetingV2: true, profileSeniority })

  it('knocks out a remote US-only role for an AU candidate needing sponsorship', () => {
    expect(v2('Support Specialist — Remote (US only)')).toBe('remote_region')
  })
  it('allows a remote role in the candidate’s region (APAC)', () => {
    expect(v2('Support — Remote (APAC)')).toBeNull()
  })
  it('allows a global remote role', () => {
    expect(v2('Support — work from anywhere')).toBeNull()
  })
  it('does not knock out remote when no region signal exists', () => {
    expect(v2('Customer Support — Remote')).toBeNull()
  })
  it('relocation-without-sponsorship escapes the region knockout', () => {
    const p = { ...AU, willingToRelocate: true, needsVisaSponsorship: false }
    expect(v2('Remote (US only)', p)).toBeNull()
  })
  it('legacy (flag off) never applies region knockout', () => {
    expect(eligibilityKnockout(AU, { country: null, isRemote: true }, { text: 'Remote (US only)' })).toBeNull()
  })
  it('seniority_mismatch: mid candidate vs Director role', () => {
    expect(v2('Director, Customer Support', AU, true, 2)).toBe('seniority_mismatch')
  })
  it('seniority ok: mid candidate vs Senior role (1 level)', () => {
    // senior=3 vs mid=2 → distance 1 → allowed (then region: global signal → null)
    expect(v2('Senior Support — work from anywhere', AU, true, 2)).toBeNull()
  })
  it('no profileSeniority → seniority check skipped', () => {
    expect(v2('Director, Support — work from anywhere', AU, true, null)).toBeNull()
  })

  // NZ-resident / AU-phone candidate (real profile): apply to NZ/AU + APAC + global,
  // skip US-only / EU-only.
  const NZAU: EligibilityProfile = {
    authorizedCountries: ['New Zealand', 'Australia'], needsVisaSponsorship: true,
    willingToRelocate: false, remoteOnly: false, languages: ['English'],
  }
  it('NZ/AU candidate: APAC-remote passes', () => {
    expect(v2('Support — Remote (APAC)', NZAU)).toBeNull()
  })
  it('NZ/AU candidate: Remote - New Zealand passes', () => {
    expect(v2('Support — Remote, New Zealand', NZAU)).toBeNull()
  })
  it('NZ/AU candidate: US-only remote knocked out', () => {
    expect(v2('Support — Remote (US only)', NZAU)).toBe('remote_region')
  })
  it('NZ/AU candidate: EMEA-only remote knocked out', () => {
    expect(v2('Support — Remote (EMEA)', NZAU)).toBe('remote_region')
  })

  // Unknown authorization (empty profile) → never skip on auth grounds (apply broadly).
  const UNKNOWN: EligibilityProfile = {
    authorizedCountries: [], needsVisaSponsorship: true,
    willingToRelocate: false, remoteOnly: false, languages: [],
  }
  it('unknown auth: US-only remote NOT skipped', () => {
    expect(v2('Remote (US only)', UNKNOWN)).toBeNull()
  })
  it('unknown auth: on-site US NOT skipped', () => {
    expect(eligibilityKnockout(UNKNOWN, { country: 'united states', isRemote: false }, { targetingV2: true })).toBeNull()
  })
})
