import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { trackEvent } from '@/lib/analytics-advanced'

/**
 * POST /api/analytics/event
 *
 * Thin server-side bridge for client-fired analytics events.
 * The client (pricing-cards, etc.) POSTs { event, properties } here;
 * we resolve the session user and persist via trackEvent → Prisma.
 *
 * Design notes:
 * - Always returns 200 so the client fire-and-forget never throws.
 * - Session is optional — anonymous events (logged-out visitors) are
 *   stored without a userId.
 * - Rate-limit or CSRF protection is intentionally omitted: these are
 *   non-sensitive marketing events; the worst-case is a spam row in
 *   analytics_events. Add rate-limiting if abuse becomes a concern.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const body = await req.json()

    const event = typeof body?.event === 'string' ? body.event : 'unknown_event'
    const properties =
      body?.properties && typeof body.properties === 'object'
        ? (body.properties as Record<string, unknown>)
        : {}

    // Visitor identity + request metadata so we can count UNIQUE visitors and
    // attribute traffic. `visitorId` is an anonymous, client-persisted id (no
    // PII). IP is read server-side from the proxy headers (Caddy → Next).
    const sessionId = typeof body?.visitorId === 'string' ? body.visitorId.slice(0, 64) : undefined
    const page = typeof body?.page === 'string' ? body.page.slice(0, 300) : undefined
    const referrer = typeof body?.referrer === 'string' ? body.referrer.slice(0, 300) : undefined
    const fwd = req.headers.get('x-forwarded-for')
    const ipAddress = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || '').trim() || undefined
    const userAgent = req.headers.get('user-agent')?.slice(0, 300) || undefined

    await trackEvent({
      event,
      userId: session?.user?.id ?? undefined,
      sessionId,
      page,
      referrer,
      ipAddress,
      userAgent,
      properties,
    })

    return NextResponse.json({ ok: true })
  } catch {
    // Non-critical — always return 200 so the client never throws.
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
