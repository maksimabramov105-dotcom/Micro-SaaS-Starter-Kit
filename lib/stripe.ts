import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
  typescript: true,
  // Retry up to 3 times on intermittent network errors (e.g. VPS → Stripe drops)
  maxNetworkRetries: 3,
  timeout: 30_000,
})

export const getStripeSession = async ({
  priceId,
  customerId,
  userId,
  toltReferral,
}: {
  priceId: string
  customerId?: string
  userId: string
  /** Tolt affiliate visitor ID from window.tolt_referral — stored in subscription metadata for conversion attribution */
  toltReferral?: string
}) => {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: userId,
    payment_method_types: ['card'],
    billing_address_collection: 'required',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    allow_promotion_codes: true,
    // Skip card collection when the total is $0 (e.g. a 100%-off promo code).
    // Normal checkouts always have a nonzero total, so they still collect a card.
    payment_method_collection: 'if_required',
    subscription_data: {
      metadata: {
        userId,
        // Tolt uses this to attribute the conversion to the correct affiliate
        ...(toltReferral ? { tolt_referral: toltReferral } : {}),
      },
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?canceled=true`,
  })

  return session
}

export const getStripeBillingPortalSession = async (customerId: string) => {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  })

  return session
}
