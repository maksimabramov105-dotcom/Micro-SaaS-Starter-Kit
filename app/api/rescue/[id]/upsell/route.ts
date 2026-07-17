/**
 * GET /api/rescue/[id]/upsell — one-click "Pro first month $9" checkout (A2).
 *
 * Creates a subscription checkout with the order's single-use promo already
 * applied (no code entry) and 303-redirects to Stripe. The webhook detects
 * metadata.upsellOrderId to record the upsell_accepted event.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await prisma.rescueOrder.findUnique({ where: { id } })

  if (!order || !order.upsellPromoId) {
    return NextResponse.redirect(`${APP_URL}/pricing`, 303)
  }
  if (!order.upsellExpiresAt || order.upsellExpiresAt < new Date()) {
    return NextResponse.redirect(`${APP_URL}/pricing?upsell=expired`, 303)
  }

  const priceId = process.env.STRIPE_PRICE_ID_PRO
  if (!priceId || !order.userId) {
    return NextResponse.redirect(`${APP_URL}/pricing`, 303)
  }

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: order.email,
      client_reference_id: order.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts: [{ promotion_code: order.upsellPromoId }],
      metadata: { upsellOrderId: order.id },
      subscription_data: { metadata: { userId: order.userId } },
      success_url: `${APP_URL}/dashboard?success=true&from=rescue_upsell`,
      cancel_url: `${APP_URL}/resume-rescue/result?order=${order.id}`,
    })
    return NextResponse.redirect(checkout.url ?? `${APP_URL}/pricing`, 303)
  } catch (err) {
    console.error('[rescue/upsell] checkout creation failed:', err)
    return NextResponse.redirect(`${APP_URL}/pricing`, 303)
  }
}
