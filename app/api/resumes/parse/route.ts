/**
 * POST /api/resumes/parse — import an existing resume into the create form (P4.1).
 *
 * The activation bottleneck this removes: /dashboard/resumes/new is a four-step
 * form asking for every job, every bullet, every date. Someone who already has a
 * resume is being asked to retype it, and time-to-first-value was measured in
 * "however long you can stand doing data entry" rather than minutes.
 *
 * Accepts a PDF (extracted by the worker, same path the paid Rescue flow uses)
 * or pasted text, and returns the form's field shape for react-hook-form reset().
 *
 * DESIGN: a failed parse is a 200 with `parsed: null`, not an error. The client
 * shows the empty form — exactly what it did before this endpoint existed — so
 * the worst case of an import is that it didn't help, never that it blocked
 * someone from creating a resume.
 *
 * Rate limited in Redis at 10/hour per user: this is an LLM call behind a button
 * that is trivially spammable, and the cost is real. Redis being down fails
 * open, consistent with lib/extension-guard.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { callWorker, WorkerError } from '@/lib/worker-client'
import { getRedis } from '@/lib/redis'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 10
const WINDOW_SECONDS = 3600
const MAX_TEXT_CHARS = 60_000
/** 5 MB as base64 is ~6.7 MB of characters; the worker enforces the real limit. */
const MAX_BASE64_CHARS = 7_000_000

export interface ParsedResume {
  fullName: string
  email: string
  phone: string
  linkedin: string
  targetRole: string
  yearsExp: number
  location: string
  workHistory: Array<{
    company: string
    role: string
    startDate: string
    endDate: string
    bullets: string[]
  }>
  education: Array<{ school: string; degree: string; year: string }>
  skills: string[]
}

async function overRateLimit(userId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = `resume:parse:rl:${userId}`
    const hits = await redis.incr(key)
    if (hits === 1) await redis.expire(key, WINDOW_SECONDS)
    return hits > RATE_LIMIT
  } catch {
    // Redis outage must not block resume creation.
    return false
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (await overRateLimit(session.user.id)) {
    return NextResponse.json(
      { error: 'Too many imports in the last hour. Try again later, or fill the form in directly.' },
      { status: 429 },
    )
  }

  let text = typeof body.text === 'string' ? body.text.trim() : ''

  // PDF path — the worker extracts, exactly as the Rescue checkout does.
  if (!text && typeof body.pdfBase64 === 'string' && body.pdfBase64) {
    if (body.pdfBase64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: 'That file is larger than 5 MB.' }, { status: 413 })
    }
    try {
      const extracted = await callWorker<{ text: string }>('/jobs/extract-resume', {
        pdf_base64: body.pdfBase64,
        filename: typeof body.filename === 'string' ? body.filename : 'resume.pdf',
      })
      text = (extracted.text ?? '').trim()
    } catch (err) {
      const message =
        err instanceof WorkerError && err.status === 422
          ? 'We could not read that PDF — it may be a scan. Paste the text instead.'
          : 'Upload failed — paste your resume text instead.'
      return NextResponse.json({ error: message }, { status: 422 })
    }
  }

  if (text.length < 100) {
    return NextResponse.json(
      { error: 'That is too short to read as a resume — paste the full text.' },
      { status: 422 },
    )
  }

  try {
    const result = await callWorker<{ parsed: ParsedResume | null }>('/jobs/parse-resume', {
      resume_text: text.slice(0, MAX_TEXT_CHARS),
    })
    return NextResponse.json({ parsed: result.parsed ?? null })
  } catch (err) {
    // The import is a convenience. If it breaks, say so plainly and let the
    // user carry on with the form rather than trapping them here.
    console.error('[resumes/parse] worker call failed', err)
    return NextResponse.json({ parsed: null })
  }
}
