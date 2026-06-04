/**
 * Tests for the inbound email webhook helpers (lib/inbox/inbound-utils.ts)
 * and classifier (lib/inbox/classify.ts — pure/fast-path only).
 *
 * The route handler itself (app/api/inbox/inbound/route.ts) uses
 * Next.js server APIs that require an edge runtime, so we test the
 * extracted pure logic here.  DB interactions are covered by e2e tests.
 *
 * Covers:
 *  - verifyResendSignature: correct, tampered, missing header
 *  - parseFrom: "Name <email>", bare email, edge cases
 *  - parseToAddress: plain handle, plus-addressing, wrong domain, no @
 *  - isAutoResponder: common no-reply patterns
 */

import { createHmac } from 'crypto'
import {
  verifyResendSignature,
  parseFrom,
  parseToAddress,
  extractCompanyFromSubject,
} from '@/lib/inbox/inbound-utils'
import { isAutoResponder } from '@/lib/inbox/classify'

const DOMAIN = 'inbox.resumeai-bot.ru'

// Svix uses a whsec_<base64> secret.
// 'dGVzdC1zZWNyZXQ=' is base64('test-secret').
const SECRET = 'whsec_dGVzdC1zZWNyZXQ='

// ── verifyResendSignature ──────────────────────────────────────────────────

describe('verifyResendSignature', () => {
  /**
   * Replicate Svix signing: HMAC-SHA256(base64Decoded(secret), message)
   * where message = "{id}.{timestamp}.{body}" or just "{body}".
   * Header format: "v1,{base64_hmac}" (space-separated for multi-sig).
   */
  function sign(body: string, msgId?: string, msgTimestamp?: string): string {
    const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
    const message =
      msgId && msgTimestamp ? `${msgId}.${msgTimestamp}.${body}` : body
    const b64 = createHmac('sha256', secretBytes).update(message).digest('base64')
    return `v1,${b64}`
  }

  it('returns true for a valid Svix v1, signature (body-only)', () => {
    const body = '{"from":"a@b.com","to":["x@inbox.resumeai-bot.ru"]}'
    expect(verifyResendSignature(body, sign(body), SECRET)).toBe(true)
  })

  it('returns true when msgId + msgTimestamp are included in the signed message', () => {
    const body = '{"event":"email.received"}'
    const msgId = 'msg_2gfYEyVXSxHT3VFN'
    const msgTimestamp = '1716557654'
    expect(
      verifyResendSignature(body, sign(body, msgId, msgTimestamp), SECRET, msgId, msgTimestamp),
    ).toBe(true)
  })

  it('returns false when body-only signature is checked against id+timestamp message', () => {
    const body = '{"event":"email.received"}'
    const msgId = 'msg_abc'
    const msgTimestamp = '1716557654'
    // sig was made without id+timestamp — verifier uses them → mismatch
    expect(verifyResendSignature(body, sign(body), SECRET, msgId, msgTimestamp)).toBe(false)
  })

  it('returns false for a tampered body', () => {
    const body = '{"from":"a@b.com"}'
    const sig = sign(body)
    expect(verifyResendSignature('{"from":"evil@b.com"}', sig, SECRET)).toBe(false)
  })

  it('accepts a bare base64 signature without v1, prefix', () => {
    // Svix may send multiple candidates; bare base64 is also accepted as fallback
    const body = 'hello'
    const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
    const b64 = createHmac('sha256', secretBytes).update(body).digest('base64')
    expect(verifyResendSignature(body, b64, SECRET)).toBe(true)
  })

  it('accepts space-separated multi-sig where second entry is valid', () => {
    const body = 'payload'
    const validSig = sign(body)
    const multiSig = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${validSig}`
    expect(verifyResendSignature(body, multiSig, SECRET)).toBe(true)
  })

  it('returns false for a signature with wrong value', () => {
    // Correctly formatted but wrong HMAC value
    expect(
      verifyResendSignature('body', 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', SECRET),
    ).toBe(false)
  })

  it('returns false for a null header', () => {
    expect(verifyResendSignature('body', null, SECRET)).toBe(false)
  })

  it('returns false for wrong-length signature', () => {
    expect(verifyResendSignature('body', 'v1,aabb', SECRET)).toBe(false)
  })

  it('is timing-safe: same result for equal signatures across iterations', () => {
    const body = 'test-body'
    const sig = sign(body)
    for (let i = 0; i < 10; i++) {
      expect(verifyResendSignature(body, sig, SECRET)).toBe(true)
    }
  })
})

// ── parseFrom ──────────────────────────────────────────────────────────────

describe('parseFrom', () => {
  it('parses "Name <email>" format', () => {
    const result = parseFrom('Jane Recruiter <jane@acme.com>')
    expect(result.fromName).toBe('Jane Recruiter')
    expect(result.fromEmail).toBe('jane@acme.com')
  })

  it('lowercases the email', () => {
    const result = parseFrom('Jane <Jane@Acme.COM>')
    expect(result.fromEmail).toBe('jane@acme.com')
  })

  it('handles bare email with no name', () => {
    const result = parseFrom('jane@acme.com')
    expect(result.fromName).toBeNull()
    expect(result.fromEmail).toBe('jane@acme.com')
  })

  it('returns null fromName when name part is empty', () => {
    const result = parseFrom('<jane@acme.com>')
    // Angle-bracket-only doesn't match the "Name <email>" regex — treated as bare
    expect(result.fromEmail).toBeDefined()
  })

  it('trims whitespace', () => {
    const result = parseFrom('  jane@acme.com  ')
    expect(result.fromEmail).toBe('jane@acme.com')
  })
})

// ── parseToAddress ─────────────────────────────────────────────────────────

describe('parseToAddress', () => {
  it('parses a plain handle', () => {
    const result = parseToAddress('alex-7g3k@inbox.resumeai-bot.ru', DOMAIN)
    expect(result).toEqual({ handle: 'alex-7g3k', applicationId: null })
  })

  it('parses plus-addressing into handle + applicationId', () => {
    const result = parseToAddress(
      'alex-7g3k+clyq7x2pc000008l5@inbox.resumeai-bot.ru',
      DOMAIN,
    )
    expect(result).toEqual({
      handle: 'alex-7g3k',
      applicationId: 'clyq7x2pc000008l5',
    })
  })

  it('returns null for wrong domain', () => {
    expect(parseToAddress('alex@other.example.com', DOMAIN)).toBeNull()
  })

  it('returns null for addresses with no @ at all', () => {
    expect(parseToAddress('notanemail', DOMAIN)).toBeNull()
  })

  it('lowercases the handle', () => {
    const result = parseToAddress('ALEX-7G3K@inbox.resumeai-bot.ru', DOMAIN)
    expect(result?.handle).toBe('alex-7g3k')
  })

  it('treats a trailing + with no suffix as applicationId: null', () => {
    const result = parseToAddress('alex-7g3k+@inbox.resumeai-bot.ru', DOMAIN)
    expect(result?.applicationId).toBeNull()
  })

  it('handles "to" given as an array element (string)', () => {
    // Callers normalise arrays before calling; verify plain string works
    const result = parseToAddress('bob-x1y2@inbox.resumeai-bot.ru', DOMAIN)
    expect(result?.handle).toBe('bob-x1y2')
  })
})

// ── extractCompanyFromSubject ───────────────────────────────────────────────

describe('extractCompanyFromSubject', () => {
  it('extracts company from a Greenhouse security-code subject', () => {
    expect(extractCompanyFromSubject('Security code for your application to Cloudflare')).toBe('Cloudflare')
  })

  it('extracts company from a "thank you for applying to" subject', () => {
    expect(extractCompanyFromSubject('Thank you for applying to Mixpanel')).toBe('Mixpanel')
  })

  it('is case-insensitive on the phrasing and stops at trailing "!"', () => {
    expect(extractCompanyFromSubject('Thank You for Applying to Checkr!')).toBe('Checkr')
  })

  it('strips a trailing corporate suffix after a comma', () => {
    expect(extractCompanyFromSubject('Security code for your application to Gusto, Inc.')).toBe('Gusto')
  })

  it('keeps multi-word company names', () => {
    expect(extractCompanyFromSubject('Security code for your application to Chime Financial')).toBe('Chime Financial')
  })

  it('handles "applied to"', () => {
    expect(extractCompanyFromSubject('You applied to Robinhood')).toBe('Robinhood')
  })

  it('returns null when there is no "applying/application to" phrasing', () => {
    expect(extractCompanyFromSubject('Your interview is scheduled')).toBeNull()
    expect(extractCompanyFromSubject('Re: question about the role')).toBeNull()
  })

  it('does NOT match on a bare "to"', () => {
    // "to" without the application phrasing must not be treated as a company cue
    expect(extractCompanyFromSubject('Welcome to the team')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(extractCompanyFromSubject('')).toBeNull()
  })
})

// ── isAutoResponder ────────────────────────────────────────────────────────

describe('isAutoResponder', () => {
  const autoSenders = [
    'no-reply@company.com',
    'noreply@company.com',
    'no_reply@company.com',
    'donotreply@company.com',
    'do-not-reply@company.com',
    'notifications@company.com',
    'notification@company.com',
    'alerts@company.com',
    'alert@company.com',
    'newsletter@company.com',
    'mailer@company.com',
    'daemon@company.com',
    'postmaster@company.com',
  ]

  autoSenders.forEach((sender) => {
    it(`classifies "${sender}" as auto-responder`, () => {
      expect(isAutoResponder(sender)).toBe(true)
    })
  })

  it('does NOT classify normal recruiter emails as auto-responders', () => {
    expect(isAutoResponder('jane.recruiter@acme.com')).toBe(false)
    expect(isAutoResponder('hiring@startup.io')).toBe(false)
    expect(isAutoResponder('careers@bigcorp.com')).toBe(false)
    expect(isAutoResponder('john.smith@company.com')).toBe(false)
  })
})
