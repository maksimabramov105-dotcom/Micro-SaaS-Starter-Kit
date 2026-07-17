/**
 * GET /api/resumes/[id]/pdf
 *
 * Download a resume as PDF. Render logic (WeasyPrint templates with
 * reportlab fallback) lives in lib/resume/render-pdf.ts, shared with the
 * guest Resume Rescue download route.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resumePdfResponse } from '@/lib/resume/render-pdf'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { id } = await params

  const resume = await prisma.resume.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!resume) return new Response('Not found', { status: 404 })

  // The download link passes ?template=<id> so the PDF always matches the
  // template the user is currently looking at — no dependency on a separate
  // "Save" click landing first.
  const requested = new URL(req.url).searchParams.get('template')
  return resumePdfResponse(resume, {
    requestedTemplate: requested,
    flagUserId: session.user.id,
  })
}
