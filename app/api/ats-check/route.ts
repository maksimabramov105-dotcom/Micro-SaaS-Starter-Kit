import { NextResponse } from 'next/server'
import { trackEvent } from '@/lib/analytics-advanced'
import { enrollLead, isSuppressed, sendFitReportEmail } from '@/lib/nurture'
import { getRedis } from '@/lib/redis'

/**
 * POST /api/ats-check — free, UNAUTHENTICATED fit check (lead magnet, C1).
 *
 * Body: { resumeText, jobDescription, jobTitle?, email?, consent? }
 *
 * Tiers:
 *   no email          → { score, findings: first 2, locked: {...}, remaining }
 *   email + consent   → full report returned + emailed (t0) + nurture
 *                       sequence enrollment (t+2d / t+5d / t+9d, stops on
 *                       purchase or unsubscribe) + lead_captured event
 *
 * Safeguards: input caps, 3 checks/IP/day via Redis, worker secret stays
 * server-side, explicit consent required for any email (C4), suppression
 * list honored.
 */
export const dynamic = 'force-dynamic'

const MAX = 20_000
const MIN = 40
const DAILY_LIMIT = 3

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim()
}

function isEmail(s: string): boolean {
  if (s.length < 5 || s.length > 254 || s.includes(' ')) return false
  const at = s.indexOf('@')
  if (at <= 0 || at !== s.lastIndexOf('@')) return false
  const dot = s.slice(at + 1).lastIndexOf('.')
  return dot > 0 && dot < s.slice(at + 1).length - 1
}

// Deterministic, honest improvement hints — prioritises the weak areas the
// scorer found, then high-value ATS best-practices. Always returns up to 3.
function buildHints(reasons: string[], score: number): string[] {
  const r = reasons.join(' ').toLowerCase()
  const hints: string[] = []
  if (r.includes('weak skills') || r.includes('some skills') || score < 70) {
    hints.push('Mirror the posting’s language: copy 6–10 of the exact skills/keywords from the job description into your Skills section and bullet points.')
  }
  if (r.includes('seniority mismatch')) {
    hints.push('Align the seniority: reflect the role’s scope (team size, ownership, years) in your titles and bullets — don’t under- or over-state your level.')
  }
  hints.push('Quantify impact: add numbers to your bullets (e.g. “resolved 80+ tickets/day”, “cut response time 35%”). Measurable results beat duties.')
  hints.push('Use an ATS-safe layout: single column, standard headings (Experience, Skills, Education), no tables/text-boxes/images that parsers garble.')
  hints.push('Lead with the exact job title from the posting near the top of your resume so keyword-matching and recruiters see the fit immediately.')
  return [...new Set(hints)].slice(0, 3)
}

export async function POST(req: Request) {
  let body: {
    resumeText?: string
    jobDescription?: string
    jobTitle?: string
    email?: string
    consent?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const resumeText = String(body.resumeText ?? '').trim()
  const jobDescription = String(body.jobDescription ?? '').trim()
  const jobTitle = String(body.jobTitle ?? '').trim().slice(0, 200)
  const email = String(body.email ?? '').trim().toLowerCase()
  const consent = body.consent === true

  if (resumeText.length < MIN || jobDescription.length < MIN) {
    return NextResponse.json(
      { error: 'Please paste both your resume and the full job description (at least a few sentences each).' },
      { status: 400 },
    )
  }
  if (resumeText.length > MAX || jobDescription.length > MAX) {
    return NextResponse.json({ error: 'That’s too long — please trim to under 20,000 characters each.' }, { status: 400 })
  }
  if (email && !isEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  // C4: no email processing without explicit consent.
  if (email && !consent) {
    return NextResponse.json(
      { error: 'Please tick the consent box so we’re allowed to email you the report.' },
      { status: 400 },
    )
  }

  // ── Rate limit: 3 / IP / day ──────────────────────────────────────────────
  const ip = clientIp(req)
  const key = `ats-check:${ip}:${new Date().toISOString().slice(0, 10)}`
  let count = 1
  try {
    const redis = getRedis()
    count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 86_400)
  } catch {
    count = 1
  }
  if (count > DAILY_LIMIT) {
    return NextResponse.json(
      { error: 'You’ve used your 3 free checks today. Come back tomorrow — or get the full rescue for one job now.' },
      { status: 429 },
    )
  }
  const remaining = Math.max(0, DAILY_LIMIT - count)

  // ── Score via the worker (server-side; secret never exposed) ───────────────
  const workerUrl = (process.env.WORKER_URL ?? 'http://worker:8000').replace(/\/$/, '')
  const workerSecret = process.env.WORKER_SECRET ?? ''
  let score = 50
  let reasons: string[] = []
  try {
    const res = await fetch(`${workerUrl}/jobs/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify({
        resume_text: resumeText.slice(0, 6000),
        jobs: [{ id: 'ats', title: jobTitle, description: jobDescription.slice(0, 6000), location: '', remote: true, country: '' }],
        eligibility: {},
        languages: [],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`worker ${res.status}`)
    const data = (await res.json()) as { scores?: Record<string, { score: number; reasons: string[] }> }
    const s = data.scores?.ats
    if (s) {
      score = Math.max(0, Math.min(100, Math.round(s.score)))
      reasons = Array.isArray(s.reasons) ? s.reasons : []
    }
  } catch {
    return NextResponse.json({ error: 'Our scorer is busy — please try again in a moment.' }, { status: 503 })
  }

  const hints = buildHints(reasons, score)

  // Funnel: every scored check counts, captured or not (C3).
  trackEvent({
    event: 'fitcheck_started',
    properties: { score, hasEmail: Boolean(email), source: 'ats-check' },
  }).catch(() => {})

  // ── Free tier: score + 2 findings; the rest is the capture incentive ──────
  if (!email) {
    return NextResponse.json({
      score,
      findings: reasons.slice(0, 2),
      locked: { findings: Math.max(0, reasons.length - 2), hints: hints.length },
      unlocked: false,
      remaining,
    })
  }

  // ── Capture: lead + nurture enrollment + t0 report email ──────────────────
  if (await isSuppressed(email)) {
    // Previously unsubscribed: honor it — return the full report on-page but
    // never email or re-enroll (C4).
    return NextResponse.json({ score, findings: reasons, hints, unlocked: true, remaining })
  }

  const lead = await enrollLead({ email, source: 'ats-check', score, jobTitle: jobTitle || undefined })
  if (lead) {
    sendFitReportEmail({ email, score, findings: reasons, hints, jobTitle: jobTitle || undefined }).catch(
      (err) => console.error('[ats-check] report email failed:', err),
    )
    trackEvent({
      event: 'lead_captured',
      properties: { leadId: lead.id, score, source: 'ats-check' },
    }).catch(() => {})
  }

  return NextResponse.json({ score, findings: reasons, hints, unlocked: true, remaining })
}
