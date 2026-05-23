/**
 * PATCH /api/resumes/[id]/template
 *
 * Save the user's chosen template for a resume.
 * Body: { templateId: string }
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED_TEMPLATES = new Set([
  'modern_minimalist',
  'classic_executive',
  'tech_compact',
  'creative_accent',
  'new_grad',
])

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const templateId =
    body && typeof body === 'object' && 'templateId' in body
      ? String((body as Record<string, unknown>).templateId)
      : null

  if (!templateId || !ALLOWED_TEMPLATES.has(templateId)) {
    return NextResponse.json(
      { error: `Invalid templateId. Must be one of: ${[...ALLOWED_TEMPLATES].join(', ')}` },
      { status: 400 },
    )
  }

  const resume = await prisma.resume.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  })
  if (!resume) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.resume.update({
    where: { id },
    data: { templateId },
  })

  return NextResponse.json({ ok: true, templateId })
}
