import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

  // Sanitise filename
  const safeTitle = resume.title
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 60) || 'resume'

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
