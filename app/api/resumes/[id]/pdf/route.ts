/**
 * GET /api/resumes/[id]/pdf
 *
 * Download a resume as PDF.
 *
 * When PDF_TEMPLATES_V1=true AND the resume has structured data:
 *   → calls worker /jobs/resumes/{id}/render (WeasyPrint + Jinja2)
 *     using Resume.templateId (default "modern_minimalist")
 *
 * Otherwise (flag OFF or no structured data):
 *   → falls back to the existing reportlab path /jobs/resume/pdf
 *     Contract unchanged: same request/response shape as before this PR.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { adaptResumeData, renderResumePdf } from '@/lib/worker-client'
import { isPdfTemplatesV1 } from '@/lib/flags'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { id } = await params

  const resume = await prisma.resume.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!resume) return new Response('Not found', { status: 404 })

  const generated = resume.generated as Record<string, unknown>

  const safeTitle = resume.title
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 60) || 'resume'

  // ── V1 template path (WeasyPrint) ─────────────────────────────────────────
  const useTemplates = await isPdfTemplatesV1(session.user.id)
  if (useTemplates) {
    try {
      const templateId = (resume as Record<string, unknown>).templateId as string | undefined
        ?? 'modern_minimalist'
      const resumeData = adaptResumeData(generated, resume.title)

      const pdfBytes = await renderResumePdf({ resumeId: id, templateId, resumeData })
      // Buffer is not assignable to BodyInit in Next.js 16 — use Uint8Array view
      return new Response(new Uint8Array(pdfBytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      })
    } catch (err) {
      // V1 path failed — fall through to legacy reportlab path
      console.warn('[pdf] template render failed, falling back to reportlab:', err)
    }
  }

  // ── Legacy reportlab path (unchanged contract) ────────────────────────────
  const resumeText =
    typeof generated?.resume_text === 'string' ? generated.resume_text : null

  if (!resumeText) {
    return new Response('Resume text not yet available — generate a resume first.', {
      status: 400,
    })
  }

  const workerUrl = process.env.WORKER_URL
  const workerSecret = process.env.WORKER_SECRET

  if (!workerUrl || !workerSecret) {
    return new Response('Worker not configured', { status: 500 })
  }

  let pdfResponse: Response
  try {
    pdfResponse = await fetch(`${workerUrl.replace(/\/$/, '')}/jobs/resume/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ resume_text: resumeText, title: resume.title }),
    })
  } catch (err) {
    console.error('[pdf] worker fetch error', err)
    return new Response('PDF service unavailable', { status: 502 })
  }

  if (!pdfResponse.ok) {
    const detail = await pdfResponse.text().catch(() => '')
    console.error('[pdf] worker error', pdfResponse.status, detail)
    return new Response('PDF generation failed', { status: 500 })
  }

  const pdfBytes = await pdfResponse.arrayBuffer()

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
