/**
 * @jest-environment node
 *
 * Resume import endpoint (P4.1).
 *
 * The governing rule is that this is a convenience, not a gate: a user who came
 * to create a resume must always end up able to create one. So a worker outage
 * degrades to "parsed: null" and the empty form, never to an error page. The
 * other half is cost — this is an LLM call behind a button, so the rate limit is
 * load-bearing.
 */
const mockGetServerSession = jest.fn()
const mockCallWorker = jest.fn()
const mockRedis = { incr: jest.fn(), expire: jest.fn() }

jest.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => mockGetServerSession(...a) }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
// redisTry wraps the command with a deadline (see lib/redis.ts). The mock
// mirrors that contract: run the command, fall back on throw — so these tests
// still exercise the rate-limit logic through mockRedis.
jest.mock('@/lib/redis', () => ({
  getRedis: () => mockRedis,
  redisTry: async (fn: (c: unknown) => Promise<unknown>, fallback: unknown) => {
    try {
      return await fn(mockRedis)
    } catch {
      return fallback
    }
  },
}))
jest.mock('@/lib/worker-client', () => {
  class WorkerError extends Error {
    constructor(public status: number, public path: string, message: string) {
      super(message)
    }
  }
  return { callWorker: (...a: unknown[]) => mockCallWorker(...a), WorkerError }
})

import { POST } from '@/app/api/resumes/parse/route'
import { WorkerError } from '@/lib/worker-client'

const RESUME = 'Ada Lovelace, Staff Engineer. '.repeat(10)

function post(body: unknown) {
  return new Request('http://localhost/api/resumes/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } })
  mockRedis.incr.mockResolvedValue(1)
  mockRedis.expire.mockResolvedValue(1)
  mockCallWorker.mockResolvedValue({ parsed: { fullName: 'Ada Lovelace' } })
})

it('requires a session', async () => {
  mockGetServerSession.mockResolvedValue(null)
  expect((await POST(post({ text: RESUME }))).status).toBe(401)
  expect(mockCallWorker).not.toHaveBeenCalled()
})

it('parses pasted text', async () => {
  const res = await POST(post({ text: RESUME }))
  expect(res.status).toBe(200)
  expect((await res.json()).parsed.fullName).toBe('Ada Lovelace')
  expect(mockCallWorker).toHaveBeenCalledWith(
    '/jobs/parse-resume',
    expect.objectContaining({ resume_text: expect.stringContaining('Ada Lovelace') }),
  )
})

it('rejects text too short to be a resume without calling the model', async () => {
  const res = await POST(post({ text: 'Ada Lovelace' }))
  expect(res.status).toBe(422)
  expect(mockCallWorker).not.toHaveBeenCalled()
})

it('extracts a PDF first, then parses it', async () => {
  mockCallWorker
    .mockResolvedValueOnce({ text: RESUME })
    .mockResolvedValueOnce({ parsed: { fullName: 'Ada' } })
  const res = await POST(post({ pdfBase64: 'JVBERi0=', filename: 'cv.pdf' }))
  expect(res.status).toBe(200)
  expect(mockCallWorker.mock.calls[0][0]).toBe('/jobs/extract-resume')
  expect(mockCallWorker.mock.calls[1][0]).toBe('/jobs/parse-resume')
})

it('tells the user to paste text when the PDF is unreadable', async () => {
  mockCallWorker.mockRejectedValueOnce(new WorkerError(422, '/jobs/extract-resume', 'nope'))
  const res = await POST(post({ pdfBase64: 'JVBERi0=' }))
  expect(res.status).toBe(422)
  expect((await res.json()).error).toMatch(/paste the text/i)
})

it('rejects an oversized upload before sending it anywhere', async () => {
  const res = await POST(post({ pdfBase64: 'A'.repeat(7_000_001) }))
  expect(res.status).toBe(413)
  expect(mockCallWorker).not.toHaveBeenCalled()
})

it('degrades to the empty form when the worker is down, rather than erroring', async () => {
  // The user came here to create a resume. An outage in an optional convenience
  // must not stop them.
  mockCallWorker.mockRejectedValue(new WorkerError(0, '/jobs/parse-resume', 'unreachable'))
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
  const res = await POST(post({ text: RESUME }))
  quiet.mockRestore()
  expect(res.status).toBe(200)
  expect((await res.json()).parsed).toBeNull()
})

it('rate limits per user', async () => {
  mockRedis.incr.mockResolvedValue(11)
  const res = await POST(post({ text: RESUME }))
  expect(res.status).toBe(429)
  expect(mockCallWorker).not.toHaveBeenCalled()
})

it('sets the window only on the first hit', async () => {
  mockRedis.incr.mockResolvedValue(2)
  await POST(post({ text: RESUME }))
  expect(mockRedis.expire).not.toHaveBeenCalled()
})

it('fails open when Redis is down', async () => {
  mockRedis.incr.mockRejectedValue(new Error('ECONNREFUSED'))
  expect((await POST(post({ text: RESUME }))).status).toBe(200)
})

it('rejects a malformed body', async () => {
  const req = new Request('http://localhost/api/resumes/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  expect((await POST(req)).status).toBe(400)
})
