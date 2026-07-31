/**
 * lib/extension-guard.ts — one gate for every extension endpoint (P2.2/P2.3).
 *
 * The extension routes previously had Bearer-key auth and nothing else: no rate
 * limit, no CORS policy, and — the one that actually matters — no server-side
 * quota. The free tier was enforced entirely in the UI, so anyone holding an
 * extension key could POST unlimited applications straight to the API.
 *
 * Three things live here so no future endpoint can forget one:
 *
 *   1. Auth      — the existing scoped Bearer key.
 *   2. Rate limit — REDIS-backed, not the in-memory limiter in lib/rate-limit.ts.
 *                   In-memory state dies with the container and is per-instance,
 *                   which makes it useless as an abuse control on a service that
 *                   redeploys several times a day.
 *   3. CORS      — locked to chrome-extension:// origins. Background-worker
 *                  fetches don't need this (host_permissions covers them), but a
 *                  content script calling us directly does, and we do not want
 *                  an arbitrary website replaying a stolen key from a browser.
 *
 * Quota is deliberately NOT folded into the guard: only write endpoints consume
 * it, and it must be checked after the request body validates, so callers invoke
 * `enforceApplicationQuota` explicitly.
 */
import { NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { validateExtensionRequest } from '@/lib/extension-auth'
import { canSendApplication } from '@/lib/quota'

/** Requests per window, per extension key. Generous for humans, not for scripts. */
const RATE_LIMIT = 60
const WINDOW_SECONDS = 60

export interface GuardOk {
  ok: true
  userId: string
  apiKeyId?: string
}
export interface GuardFail {
  ok: false
  response: NextResponse
}
export type GuardResult = GuardOk | GuardFail

/** CORS headers. Chrome extension origins are opaque per install, so we allow
 *  the scheme rather than a single ID — the Bearer key is the real authority. */
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin?.startsWith('chrome-extension://') ? origin : ''
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Preflight handler — export as OPTIONS from any extension route. */
export function extensionPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) })
}

/** Attach CORS to a response produced by an extension route. */
export function withCors(request: Request, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(request.headers.get('origin')))) {
    res.headers.set(k, v)
  }
  return res
}

/**
 * Authenticate + rate-limit. Returns the userId or a ready-to-return response.
 *
 * Fails OPEN on a Redis outage: Redis going down must not take the extension
 * with it. Auth still gates access, so the worst case is an unthrottled window.
 */
export async function guardExtensionRequest(request: Request): Promise<GuardResult> {
  const auth = await validateExtensionRequest(request)
  if (!auth.valid || !auth.userId) {
    return {
      ok: false,
      response: withCors(request, new NextResponse(auth.error ?? 'Unauthorized', { status: 401 })),
    }
  }

  try {
    const key = `ext:rl:${auth.apiKeyId ?? auth.userId}`
    const redis = getRedis()
    const hits = await redis.incr(key)
    if (hits === 1) await redis.expire(key, WINDOW_SECONDS)
    if (hits > RATE_LIMIT) {
      const ttl = await redis.ttl(key)
      const res = NextResponse.json(
        { error: 'Too many requests', retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS },
        { status: 429 },
      )
      res.headers.set('Retry-After', String(ttl > 0 ? ttl : WINDOW_SECONDS))
      res.headers.set('X-RateLimit-Limit', String(RATE_LIMIT))
      res.headers.set('X-RateLimit-Remaining', '0')
      return { ok: false, response: withCors(request, res) }
    }
  } catch (err) {
    console.warn('[extension-guard] rate limit unavailable, failing open:', err)
  }

  return { ok: true, userId: auth.userId, apiKeyId: auth.apiKeyId }
}

/**
 * P2.3 — server-side free-tier enforcement for anything that records an
 * application. Mirrors the same daily limit the backend apply path uses, so the
 * extension cannot be used to bypass it.
 */
export async function enforceApplicationQuota(
  request: Request,
  userId: string,
): Promise<NextResponse | null> {
  const allowed = await canSendApplication(userId)
  if (allowed) return null
  return withCors(
    request,
    NextResponse.json(
      {
        error: 'Daily application limit reached',
        upgradeUrl: 'https://resumeai-bot.com/pricing',
      },
      { status: 429 },
    ),
  )
}
