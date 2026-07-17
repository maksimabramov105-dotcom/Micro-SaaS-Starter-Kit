/**
 * lib/resume/render-pdf.ts — single source for turning a Resume row into a
 * downloadable PDF Response. Used by the authed /api/resumes/[id]/pdf route
 * and the guest Resume Rescue download route (A2).
 *
 * Path selection mirrors the original route: WeasyPrint template render when
 * PDF_TEMPLATES_V1 is on and structured data adapts, otherwise the legacy
 * reportlab plain-text path.
 */
import { isPdfTemplatesV1 } from '@/lib/flags'
import { adaptResumeData, renderResumePdf } from '@/lib/worker-client'
import type { Resume } from '@prisma/client'

export const ALLOWED_TEMPLATES = new Set([
  'modern_minimalist',
  'classic_executive',
  'tech_compact',
  'creative_accent',
  'new_grad',
])

export async function resumePdfResponse(
  resume: Resume,
  opts: { requestedTemplate?: string | null; flagUserId?: string } = {},
): Promise<Response> {
  const generated = resume.generated as Record<string, unknown>
  const safeTitle =
    resume.title
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .slice(0, 60) || 'resume'

  const pdfHeaders = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
    'Cache-Control': 'private, no-store',
  }

  // ── V1 template path (WeasyPrint) ─────────────────────────────────────────
  const useTemplates = await isPdfTemplatesV1(opts.flagUserId)
  if (useTemplates) {
    try {
      const requested = opts.requestedTemplate
      const templateId =
        requested && ALLOWED_TEMPLATES.has(requested)
          ? requested
          : (resume.templateId ?? 'modern_minimalist')
      const resumeData = adaptResumeData(generated, resume.title)

      const pdfBytes = await renderResumePdf({ resumeId: resume.id, templateId, resumeData })
      // Buffer is not assignable to BodyInit in Next.js 16 — use Uint8Array view
      return new Response(new Uint8Array(pdfBytes), { headers: pdfHeaders })
    } catch (err) {
      console.warn('[pdf] template render failed, falling back to reportlab:', err)
    }
  }

  // ── Legacy reportlab path (unchanged contract) ────────────────────────────
  const resumeText = typeof generated?.resume_text === 'string' ? generated.resume_text : null
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
  return new Response(pdfBytes, { headers: pdfHeaders })
}
