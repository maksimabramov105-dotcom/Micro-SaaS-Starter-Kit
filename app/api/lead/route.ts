/**
 * POST /api/lead
 *
 * Public email-capture endpoint for lead-magnet pages (e.g. the free
 * resume-teardown landing page). Stores { email, source } in the Lead table.
 * No auth — it's a top-of-funnel capture. Validates email format and length.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_LIMIT = 10 // captures per IP per hour — generous for humans, caps spam

export async function POST(req: Request) {
  // ── Rate limit (P2 audit): public + unauthenticated, so a bot could flood the
  // Lead table. Per-IP hourly window; fails open if Redis is down so real
  // captures are never blocked by an outage.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  try {
    const redis = getRedis()
    const n = await redis.incr(`lead-rl:${ip}`)
    if (n === 1) await redis.expire(`lead-rl:${ip}`, 3600)
    if (n > RATE_LIMIT) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }
  } catch {
    /* Redis unavailable → skip rate limiting (fail open) */
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const email = typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : ''
  const source =
    typeof obj.source === 'string' ? obj.source.trim().slice(0, 80) : 'unknown'

  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  try {
    await prisma.lead.create({ data: { email, source } })
  } catch (err) {
    console.error('[lead] create failed', err)
    // Don't leak internals; treat as success-ish so the UX isn't blocked by
    // transient/duplicate issues, but signal non-200 for real failures.
    return NextResponse.json({ error: 'Could not save right now. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
