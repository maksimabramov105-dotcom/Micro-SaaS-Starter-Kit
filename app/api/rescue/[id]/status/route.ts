/**
 * GET /api/rescue/[id]/status — result-page polling endpoint (A2).
 *
 * Returns the order's public state. When the order is PAID, the first poll
 * to arrive wins the Redis lock and runs generation INLINE (~30-90s on this
 * self-hosted deployment); competing polls see GENERATING and keep waiting.
 *
 * No auth by design: the order id is an unguessable cuid that the buyer
 * receives via the Stripe redirect + email. Response never includes the
 * resume text or any payment identifiers.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processRescueOrder } from '@/lib/rescue/generate'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || id.length > 40) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  let order = await prisma.rescueOrder.findUnique({ where: { id } })
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Drive the order forward when it is waiting on generation.
  if (order.status === 'PAID') {
    order = (await processRescueOrder(id)) ?? order
  }

  return NextResponse.json({
    status: order.status,
    jobTitle: order.jobTitle,
    jobCompany: order.jobCompany,
    fitReport: order.status === 'DELIVERED' ? order.fitReport : null,
    resumeId: order.status === 'DELIVERED' ? order.resumeId : null,
    upsell:
      order.status === 'DELIVERED' &&
      order.upsellPromoId &&
      order.upsellExpiresAt &&
      order.upsellExpiresAt > new Date()
        ? { expiresAt: order.upsellExpiresAt }
        : null,
  })
}
