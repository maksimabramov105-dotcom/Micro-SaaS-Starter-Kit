/**
 * @jest-environment node
 *
 * Node, not the project-wide jsdom: this is the first suite to import
 * `next/server`, which needs the WHATWG Request/Response globals that jsdom
 * does not provide. Scoped per-file so the rest of the suite is untouched.
 */
/**
 * Extension guard (P2.2/P2.3).
 *
 * These cover the paid boundary, so they assert behaviour rather than shape:
 * an unauthenticated caller is refused, a caller over the daily free-tier limit
 * is refused with an upgrade path, a Redis outage does NOT lock everyone out,
 * and CORS is only granted to a chrome-extension origin.
 */
import { NextResponse } from 'next/server'

const mockValidate = jest.fn()
const mockCanSend = jest.fn()
const mockRedis = { incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() }

jest.mock('@/lib/extension-auth', () => ({
  validateExtensionRequest: (...a: unknown[]) => mockValidate(...a),
}))
jest.mock('@/lib/quota', () => ({
  canSendApplication: (...a: unknown[]) => mockCanSend(...a),
}))
jest.mock('@/lib/redis', () => ({
  getRedis: () => mockRedis,
}))

import {
  guardExtensionRequest,
  enforceApplicationQuota,
  extensionPreflight,
  withCors,
} from '@/lib/extension-guard'

const req = (origin?: string) =>
  new Request('https://resumeai-bot.com/api/extension/resume', {
    headers: origin ? { origin } : {},
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockRedis.incr.mockResolvedValue(1)
  mockRedis.expire.mockResolvedValue(1)
  mockRedis.ttl.mockResolvedValue(60)
})

describe('guardExtensionRequest', () => {
  it('refuses a request with no valid extension key', async () => {
    mockValidate.mockResolvedValue({ valid: false, error: 'Invalid or expired extension key' })
    const r = await guardExtensionRequest(req())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it('passes a valid key through with its userId', async () => {
    mockValidate.mockResolvedValue({ valid: true, userId: 'u1', apiKeyId: 'k1' })
    const r = await guardExtensionRequest(req())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.userId).toBe('u1')
  })

  it('rate limits per API KEY, not per user, and reports Retry-After', async () => {
    mockValidate.mockResolvedValue({ valid: true, userId: 'u1', apiKeyId: 'k1' })
    mockRedis.incr.mockResolvedValue(61) // one past the limit
    mockRedis.ttl.mockResolvedValue(42)
    const r = await guardExtensionRequest(req())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(429)
      expect(r.response.headers.get('Retry-After')).toBe('42')
    }
    expect(mockRedis.incr).toHaveBeenCalledWith('ext:rl:k1')
  })

  it('sets the window TTL only on the first hit', async () => {
    mockValidate.mockResolvedValue({ valid: true, userId: 'u1', apiKeyId: 'k1' })
    mockRedis.incr.mockResolvedValue(2)
    await guardExtensionRequest(req())
    expect(mockRedis.expire).not.toHaveBeenCalled()
  })

  it('FAILS OPEN when Redis is down — an outage must not disable the extension', async () => {
    mockValidate.mockResolvedValue({ valid: true, userId: 'u1', apiKeyId: 'k1' })
    mockRedis.incr.mockRejectedValue(new Error('ECONNREFUSED'))
    const r = await guardExtensionRequest(req())
    expect(r.ok).toBe(true)
  })
})

describe('enforceApplicationQuota (the free-tier boundary)', () => {
  it('allows a user under their daily limit', async () => {
    mockCanSend.mockResolvedValue(true)
    expect(await enforceApplicationQuota(req(), 'u1')).toBeNull()
  })

  it('blocks a user at their limit and returns an upgrade path', async () => {
    mockCanSend.mockResolvedValue(false)
    const res = await enforceApplicationQuota(req(), 'u1')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    const body = await res!.json()
    expect(body.upgradeUrl).toContain('/pricing')
  })
})

describe('CORS', () => {
  it('echoes only a chrome-extension origin', () => {
    const res = withCors(req('chrome-extension://abcdef'), NextResponse.json({}))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdef')
  })

  it('refuses to echo an arbitrary website origin', () => {
    const res = withCors(req('https://evil.example'), NextResponse.json({}))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers preflight with 204', () => {
    expect(extensionPreflight(req('chrome-extension://abcdef')).status).toBe(204)
  })
})
