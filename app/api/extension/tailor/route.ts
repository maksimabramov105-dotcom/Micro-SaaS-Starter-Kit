/**
 * POST /api/extension/tailor
 *
 * "Tailor resume for this job" — requirement 3 of P2.1, and the piece that makes
 * the extension more than an autofiller. Wires the extension to the worker's
 * /jobs/autoapply/prepare, which existed but had no caller from the extension
 * side (the known TODO in the brief).
 *
 * Body: { jobTitle, company, jobDescription?, jobUrl?, resumeId? }
 * Returns: { tailoredResume, coverLetter, tokensUsed, tailoringSkipped, resumeId }
 *
 * Quota: tailoring is the expensive call (it is the LLM spend), so it consumes
 * the same daily allowance as recording an application. Free tier gets it too —
 * a free user who cannot feel the value never converts — but bounded.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callWorker } from '@/lib/worker-client'
import {
  guardExtensionRequest,
  enforceApplicationQuota,
  extensionPreflight,
  withCors,
} from '@/lib/extension-guard'

export const dynamic = 'force-dynamic'

/** Map the user's Stripe price to the worker's plan_tier gate. */
function planTier(stripePriceId: string | null, dailyLimit: number): string {
  if (!stripePriceId) return 'free'
  return dailyLimit >= 9999 ? 'unlimited' : 'pro'
}

export function OPTIONS(request: Request) {
  return extensionPreflight(request)
}

export async function POST(request: Request) {
  const guard = await guardExtensionRequest(request)
  if (!guard.ok) return guard.response
  const userId = guard.userId

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return withCors(request, new NextResponse('Invalid JSON body', { status: 400 }))
  }

  const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : ''
  const company = typeof body.company === 'string' ? body.company.trim() : ''
  const jobDescription =
    typeof body.jobDescription === 'string' ? body.jobDescription.trim().slice(0, 12000) : ''
  const jobUrl = typeof body.jobUrl === 'string' ? body.jobUrl.slice(0, 2048) : ''

  if (!jobTitle || !company) {
    return withCors(
      request,
      NextResponse.json({ error: 'jobTitle and company are required' }, { status: 400 }),
    )
  }

  // Same daily allowance as recording an application — tailoring is the LLM
  // spend, so leaving it unmetered is how the free tier becomes expensive.
  const overQuota = await enforceApplicationQuota(request, userId)
  if (overQuota) return overQuota

  try {
    const [user, resume] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { stripePriceId: true, dailyApplicationLimit: true },
      }),
      typeof body.resumeId === 'string' && body.resumeId
        ? prisma.resume.findFirst({ where: { id: body.resumeId, userId } })
        : prisma.resume.findFirst({
            where: { userId },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          }),
    ])

    if (!resume) {
      return withCors(
        request,
        NextResponse.json(
          { error: 'No resume found. Create one at resumeai-bot.com/dashboard/resumes.' },
          { status: 404 },
        ),
      )
    }

    const result = await callWorker<{
      result?: {
        tailored_resume?: unknown
        tailored_cover_letter?: string
        tokens_used?: number
        tailoring_skipped?: boolean
      }
    }>('/jobs/autoapply/prepare', {
      base_resume: resume.generated ?? {},
      job: { title: jobTitle, company, description: jobDescription, id: jobUrl },
      plan_tier: planTier(user?.stripePriceId ?? null, user?.dailyApplicationLimit ?? 3),
      application_count: 0,
      // Stable cache key: the same job + resume pair must never bill twice
      // (economics guardrail — tailoring must stay under $0.05/application).
      job_id: jobUrl || `${company}:${jobTitle}`,
    })

    const r = result?.result ?? {}
    return withCors(
      request,
      NextResponse.json({
        tailoredResume: r.tailored_resume ?? null,
        coverLetter: r.tailored_cover_letter ?? '',
        tokensUsed: r.tokens_used ?? 0,
        tailoringSkipped: r.tailoring_skipped ?? false,
        resumeId: resume.id,
      }),
    )
  } catch (err) {
    console.error('[extension/tailor] error:', err)
    return withCors(
      request,
      NextResponse.json({ error: 'Tailoring failed. Please try again.' }, { status: 502 }),
    )
  }
}
