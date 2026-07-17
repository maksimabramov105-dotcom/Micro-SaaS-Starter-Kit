/**
 * GET /api/rescue/[id]/download?template=<id> — guest PDF download (A2).
 *
 * The buyer paid but has no session yet (guest checkout); the unguessable
 * order cuid is the access token, same trust model as the status route.
 * All 5 templates are unlocked for the rescue resume via ?template=.
 */
export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { resumePdfResponse } from '@/lib/resume/render-pdf'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await prisma.rescueOrder.findUnique({ where: { id } })
  if (!order || order.status !== 'DELIVERED' || !order.resumeId) {
    return new Response('Not found', { status: 404 })
  }

  const resume = await prisma.resume.findUnique({ where: { id: order.resumeId } })
  if (!resume) return new Response('Not found', { status: 404 })

  const requested = new URL(req.url).searchParams.get('template')
  return resumePdfResponse(resume, {
    requestedTemplate: requested,
    flagUserId: order.userId ?? undefined,
  })
}
