import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { sendEmail } from '@/lib/email'

/**
 * POST /api/ats-check — free, UNAUTHENTICATED ATS/job-fit check (lead magnet).
 *
 * Body: { resumeText, jobDescription, email? }
 * Returns: { score, hints[], remaining }
 *
 * Safeguards (public endpoint): input size caps, 3 checks/IP/day via Redis,
 * worker call is server-side only (Bearer WORKER_SECRET never leaves the server),
 * email capture creates a Lead + sends ONE follow-up (no sequence).
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
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
  let body: { resumeText?: string; jobDescription?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const resumeText = String(body.resumeText ?? '').trim()
  const jobDescription = String(body.jobDescription ?? '').trim()
  const email = String(body.email ?? '').trim()

  if (resumeText.length < MIN || jobDescription.length < MIN) {
    return NextResponse.json(
      { error: 'Please paste both your resume and the full job description (at least a few sentences each).' },
      { status: 400 },
    )
  }
  if (resumeText.length > MAX || jobDescription.length > MAX) {
    return NextResponse.json({ error: 'That’s too long — please trim to under 20,000 characters each.' }, { status: 400 })
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
    // Redis down — fail open (don't block a real user), but don't loop email.
    count = 1
  }
  if (count > DAILY_LIMIT) {
    return NextResponse.json(
      { error: 'You’ve used your 3 free checks today. Come back tomorrow — or start free to auto-apply with a tailored resume.' },
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
        jobs: [{ id: 'ats', title: '', description: jobDescription.slice(0, 6000), location: '', remote: true, country: '' }],
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

  // ── Optional email capture → Lead + ONE follow-up (best-effort) ────────────
  if (email && isEmail(email)) {
    prisma.lead.create({ data: { email, source: 'ats-check' } }).catch(() => {})
    const list = hints.map((h) => `<li style="margin-bottom:8px">${h}</li>`).join('')
    sendEmail({
      to: email,
      subject: `Your ATS match score: ${score}/100`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
        <h2 style="color:#065f46">Your ATS match score: ${score}/100</h2>
        <p>Here are your top 3 fixes to improve the match:</p>
        <ol>${list}</ol>
        <p style="margin-top:16px">Want this done for you? ResumeAI tailors your resume to every role and
        auto-applies only where you’re eligible — <a href="https://resumeai-bot.ru/login">start free</a>.</p>
        <p style="color:#94a3b8;font-size:12px">You got this email because you ran a free ATS check on resumeai-bot.ru.</p>
      </div>`,
    }).catch(() => {})
  }

  return NextResponse.json({ score, hints, remaining })
}
