import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { getPlanByPriceId } from '@/lib/pricing'

export async function POST(req: Request) {
  const body = await req.text()
  const signature = (await headers()).get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return new NextResponse(`Webhook Error: ${msg}`, { status: 400 })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const subscription = event.data.object as Stripe.Subscription

  switch (event.type) {
    case 'checkout.session.completed': {
      if (session.mode === 'subscription') {
        const subscriptionId = session.subscription as string
        const customerId = session.customer as string
        const userId = session.client_reference_id || session.metadata?.userId

        if (!userId) {
          return new NextResponse('No user ID found', { status: 400 })
        }

        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId)
        const priceId = stripeSubscription.items.data[0].price.id
        const plan = getPlanByPriceId(priceId)

        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            dailyApplicationLimit: plan.dailyLimit,
          },
        })
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const invoiceSubscriptionId = subscription.id
      const stripeSubscription = await stripe.subscriptions.retrieve(invoiceSubscriptionId)
      const priceId = stripeSubscription.items.data[0].price.id
      const plan = getPlanByPriceId(priceId)

      await prisma.user.update({
        where: { stripeSubscriptionId: invoiceSubscriptionId },
        data: {
          stripePriceId: priceId,
          stripeCurrentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          dailyApplicationLimit: plan.dailyLimit,
        },
      })
      break
    }

    case 'customer.subscription.updated': {
      const priceId = subscription.items.data[0].price.id
      const plan = getPlanByPriceId(priceId)

      await prisma.user.update({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          stripePriceId: priceId,
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
          dailyApplicationLimit: plan.dailyLimit,
        },
      })
      break
    }

    case 'customer.subscription.deleted': {
      const freePlan = getPlanByPriceId(null)

      await prisma.user.update({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          stripePriceId: null,
          stripeCurrentPeriodEnd: null,
          dailyApplicationLimit: freePlan.dailyLimit,
        },
      })
      break
    }

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  return new NextResponse(null, { status: 200 })
}
