import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripeSession } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { getPlanById, getPlanForCheckout, type BillingInterval } from '@/lib/pricing'
import { trackEvent } from '@/lib/analytics-advanced'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await req.json()

    // ── Resolve Stripe price ID ──────────────────────────────────────────────
    //
    // Accepts one of three call shapes (all from the client):
    //   1. { planId: 'pro', interval: 'year' }   → getPlanForCheckout (Prompt 05)
    //   2. { planId: 'pro' }                       → getPlanById (monthly default)
    //   3. { priceId: 'price_xxx' }               → legacy/direct (backwards-compat)
    //
    // Price IDs are server-only env vars — never bundled into the client.

    const interval: BillingInterval = body.interval === 'year' ? 'year' : 'month'
    let priceId: string | null = body.priceId ?? null

    if (body.planId) {
      const family = body.planId as 'pro' | 'unlimited'
      // getPlanForCheckout works for known families; fall back to getPlanById
      // for unknown slugs so existing behaviour is preserved.
      const plan =
        (family === 'pro' || family === 'unlimited')
          ? (getPlanForCheckout(family, interval) ?? getPlanById(body.planId))
          : getPlanById(body.planId)
      priceId = plan.priceId ?? null
    }

    if (!priceId) {
      return new NextResponse(
        'This plan is not available for purchase. Stripe price ID is not configured on the server.',
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeCustomerId: true },
    })

    const checkoutSession = await getStripeSession({
      priceId,
      customerId: user?.stripeCustomerId || undefined,
      userId: session.user.id,
    })

    // ── Analytics: checkout_started ─────────────────────────────────────────
    // Fire-and-forget — never block the redirect on analytics.
    trackEvent({
      event: 'checkout_started',
      userId: session.user.id,
      properties: {
        planId: body.planId ?? null,
        interval,
        priceId,
      },
    }).catch((err: unknown) =>
      console.warn('[checkout] analytics track failed:', err)
    )

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error creating checkout session:', message)

    // Distinguish Stripe network errors (intermittent) from config errors
    if (
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ECONNRESET')
    ) {
      return new NextResponse(
        'Payment service temporarily unavailable — please try again in a moment.',
        { status: 503 }
      )
    }

    return new NextResponse(
      'Unable to start checkout. Please try again or contact support.',
      { status: 500 }
    )
  }
}
