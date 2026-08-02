/**
 * POST /api/lead
 *
 * Public email-capture endpoint for lead-magnet pages. No auth — it's a
 * top-of-funnel capture.
 *
 * It used to be `prisma.lead.create({ email, source })` and nothing else, which
 * made it a hole in three rules the rest of the funnel keeps:
 *   - an address that had UNSUBSCRIBED could be written straight back in, because
 *     nothing consulted the suppression list;
 *   - `consentAt` stayed null, so C4 ("no email processing without explicit
 *     consent") had nothing recorded to rely on;
 *   - `nurtureStage`/`nurtureNextAt` kept their defaults (0 / null), and
 *     processNurtureQueue only ever selects rows with a non-null nurtureNextAt
 *     AND a non-null consentAt — so every address captured here was enrolled in
 *     nothing and could never be emailed at all.
 *
 * It now goes through enrollLead(), which is where all three live. Note it still
 * sends NOTHING itself: a caller that promises the visitor an email must send
 * that email on its own path (see /api/ats-check, which returns the report and
 * mails it). The exit-intent modal promised one here and none was ever sent.
 */
import { NextResponse } from 'next/server'
import { redisTry } from '@/lib/redis'
import { enrollLead } from '@/lib/nurture'
import { trackEvent } from '@/lib/analytics-advanced'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_LIMIT = 10 // captures per IP per hour — generous for humans, caps spam

export async function POST(req: Request) {
  // ── Rate limit (P2 audit): public + unauthenticated, so a bot could flood the
  // Lead table. Per-IP hourly window; fails open if Redis is down so real
  // captures are never blocked by an outage.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  // redisTry, not try/catch: the client queues commands while Redis is down, so
  // an await here hangs instead of throwing and the fail-open never runs.
  const n = await redisTry(
    async (redis) => {
      const hits = await redis.incr(`lead-rl:${ip}`)
      if (hits === 1) await redis.expire(`lead-rl:${ip}`, 3600)
      return hits
    },
    0,
  )
  if (n > RATE_LIMIT) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
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

  // C4, same rule /api/ats-check enforces: no address is processed for email
  // without an explicit affirmative act by the person it belongs to.
  if (obj.consent !== true) {
    return NextResponse.json(
      { error: 'Please tick the consent box so we’re allowed to email you.' },
      { status: 400 },
    )
  }

  try {
    // enrollLead returns null when the address is on the suppression list. That
    // is a success from the visitor's side — we simply do not re-add someone who
    // asked us to stop — so it answers ok without a row and without an event.
    const lead = await enrollLead({ email, source })
    if (lead) {
      trackEvent({ event: 'lead_captured', properties: { leadId: lead.id, source } }).catch(() => {})
    }
  } catch (err) {
    console.error('[lead] capture failed', err)
    // Don't leak internals; signal non-200 so the caller can say something true.
    return NextResponse.json({ error: 'Could not save right now. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
