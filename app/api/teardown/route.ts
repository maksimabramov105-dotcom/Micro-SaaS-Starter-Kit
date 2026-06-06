/**
 * POST /api/teardown — instant, anonymous AI resume teardown (D4).
 *
 * Anonymous user pastes their resume + target role and gets value in <60s:
 * an ATS readiness score, missing keywords, and 3 concrete fixes. No login.
 *
 * Cost/abuse controls: per-IP hourly rate limit (Redis, fail-open), input
 * truncation, and a capped max_tokens. Fires a 'teardown_completed' analytics
 * event so teardown → signup conversion is measurable.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { trackEvent } from '@/lib/analytics-advanced'

const RATE_LIMIT = 5 // teardowns per IP per hour
const MAX_RESUME_CHARS = 6000

const SYSTEM = `You are an expert technical recruiter and ATS specialist. Given a resume and a target role, return STRICT JSON only (no prose) with this shape:
{"score": <integer 0-100 ATS-readiness>, "missingKeywords": [up to 8 short strings], "fixes": [exactly 3 specific, concrete rewrite suggestions as short strings]}
Be honest and specific. "score" reflects how likely the resume passes an ATS for that role.`

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  // ── Rate limit (fail-open) ───────────────────────────────────────────────
  try {
    const redis = getRedis()
    const n = await redis.incr(`teardown-rl:${ip}`)
    if (n === 1) await redis.expire(`teardown-rl:${ip}`, 3600)
    if (n > RATE_LIMIT) {
      return NextResponse.json({ error: 'Too many teardowns this hour. Please try again later.' }, { status: 429 })
    }
  } catch { /* Redis down → skip limiting */ }

  let body: { resumeText?: string; targetRole?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const resumeText = (body.resumeText ?? '').trim().slice(0, MAX_RESUME_CHARS)
  const targetRole = (body.targetRole ?? '').trim().slice(0, 120) || 'the target role'
  if (resumeText.length < 80) {
    return NextResponse.json({ error: 'Please paste your full resume (at least a few lines).' }, { status: 400 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Teardown is temporarily unavailable.' }, { status: 503 })
  }
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Target role: ${targetRole}\n\nResume:\n${resumeText}` },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      console.error('[teardown] LLM error', res.status)
      return NextResponse.json({ error: 'Could not generate a teardown right now. Please try again.' }, { status: 502 })
    }
    const data = await res.json()
    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    const json = text.match(/\{[\s\S]*\}/)
    const parsed = json ? JSON.parse(json[0]) : {}
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0))
    const missingKeywords = Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords.slice(0, 8).map(String) : []
    const fixes = Array.isArray(parsed.fixes) ? parsed.fixes.slice(0, 3).map(String) : []
    if (!fixes.length) {
      return NextResponse.json({ error: 'Could not analyze that resume. Please try again.' }, { status: 502 })
    }

    trackEvent({ event: 'teardown_completed', properties: { targetRole, score } }).catch(() => {})
    return NextResponse.json({ score, missingKeywords, fixes })
  } catch (err) {
    console.error('[teardown] error', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not generate a teardown right now. Please try again.' }, { status: 502 })
  }
}
