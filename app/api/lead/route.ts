/**
 * POST /api/lead
 *
 * Public email-capture endpoint for lead-magnet pages (e.g. the free
 * resume-teardown landing page). Stores { email, source } in the Lead table.
 * No auth — it's a top-of-funnel capture. Validates email format and length.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
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
