import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      stripeCustomerId?: string | null
      stripeSubscriptionId?: string | null
      stripePriceId?: string | null
      stripeCurrentPeriodEnd?: Date | null
    }
  }
}
