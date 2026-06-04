/**
 * Tests for the pre-apply eligibility gate (lib/eligibility.ts).
 * Mirrors the worker resolver (worker/.../eligibility.py).
 */
import {
  normalizeCountry,
  inferJobLocation,
  eligibilityKnockout,
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
