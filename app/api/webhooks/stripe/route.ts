import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
// getPlanByPriceId handles both monthly AND yearly price IDs automatically —
// no changes needed here when adding annual plans (Prompt 05).
import { getPlanByPriceId } from '@/lib/pricing'
import { qualifyReferral, clawbackReferral } from '@/lib/referral'
import { sendPaymentFailedEmail } from '@/lib/email'

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

  // ── Idempotency guard (RED-1 audit fix) ───────────────────────────────────
  // Stripe may retry delivery; skip double-processing by recording the event ID.
  // IMPORTANT: the event is recorded as processed only AFTER the handler below
  // succeeds (see the end of this function). Recording it up-front meant a
  // transient error mid-handler (e.g. subscriptions.retrieve / user.update) left
  // the event marked done, so Stripe's retry was skipped and a paying user's
  // subscription was never recorded. Now a failed handler throws/returns non-200,
  // no row is written, and Stripe's retry reprocesses it.
  const alreadyProcessed = await prisma.stripeEvent.findUnique({
    where: { id: event.id },
  })
  if (alreadyProcessed) {
    return new NextResponse(null, { status: 200 })
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

        // Set firstPaidAt only once — never overwrite it on renewals
        const existingUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { firstPaidAt: true },
        })

        const isFirstPayment = existingUser?.firstPaidAt == null

        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            dailyApplicationLimit: plan.dailyLimit,
            // Record first paid date for PMF cohort retention tracking
            ...(isFirstPayment ? { firstPaidAt: new Date() } : {}),
          },
        })

        // Qualify any pending referral on the referee's first payment
        if (isFirstPayment && customerId) {
          try {
            await qualifyReferral(userId, customerId)
          } catch (err) {
            // Non-fatal — referral can be manually rewarded if this fails
            console.error('[webhook] referral qualification failed for user', userId, err)
          }
        }
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
          // Record cancellation date for PMF churn / exit-reason histogram
          cancelledAt: new Date(),
        },
      })
      break
    }

    case 'invoice.payment_failed': {
      // A renewal charge failed.  Log it and nudge the user to update their card.
      // Stripe will retry automatically (up to 4 attempts over ~1 week by default).
      const failedInvoice = event.data.object as Stripe.Invoice
      const failedCustomerId = typeof failedInvoice.customer === 'string'
        ? failedInvoice.customer
        : (failedInvoice.customer as Stripe.Customer | null)?.id

      console.error('[webhook] invoice.payment_failed', {
        invoiceId: failedInvoice.id,
        customerId: failedCustomerId,
        subscriptionId: failedInvoice.subscription,
        attemptCount: failedInvoice.attempt_count,
        amountDue: failedInvoice.amount_due,
        nextPaymentAttempt: failedInvoice.next_payment_attempt,
      })

      if (failedCustomerId) {
        try {
          const user = await prisma.user.findFirst({
            where: { stripeCustomerId: failedCustomerId },
            select: { email: true },
          })
          if (user?.email) {
            await sendPaymentFailedEmail(user.email, failedInvoice.attempt_count ?? 1)
          }
        } catch (err) {
          // Non-fatal — payment failed email is best-effort
          console.error('[webhook] failed to send payment_failed email for customer', failedCustomerId, err)
        }
      }
      break
    }

    case 'charge.refunded': {
      // Out-of-band reconciliation — fires when a refund is issued outside the
      // self-serve route (e.g. manual refund from Stripe Dashboard).
      // Sets refundedAt only if not already set to stay idempotent.
      const charge = event.data.object as Stripe.Charge
      const customerId = typeof charge.customer === 'string'
        ? charge.customer
        : charge.customer?.id

      if (customerId) {
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true, refundedAt: true },
        })
        if (user && user.refundedAt == null) {
          await prisma.user.update({
            where: { id: user.id },
            data: { refundedAt: new Date() },
          })
        }

        // Clawback referral reward if the refund is within 30 days of first payment
        try {
          await clawbackReferral(customerId)
        } catch (err) {
          console.error('[webhook] referral clawback failed for customer', customerId, err)
        }
      }
      break
    }

    default:
      console.log(`Unhandled event type: ${event.type}`)
  }

  // Handler succeeded — now record the event so retries are idempotent. Wrapped
  // because a rare concurrent double-delivery could race here; the unique PK
  // makes the second insert throw, but processing was idempotent so we ignore it.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id } })
  } catch {
    /* already recorded by a concurrent delivery — safe to ignore */
  }

  return new NextResponse(null, { status: 200 })
}
