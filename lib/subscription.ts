export const PLANS = [
  {
    name: 'Free',
    slug: 'free',
    price: {
      monthly: 0,
      yearly: 0,
    },
    priceId: {
      monthly: null,
      yearly: null,
    },
    features: [
      '10 projects',
      'Basic analytics',
      'Community support',
      '1 GB storage',
    ],
    limits: {
      projects: 10,
      storage: 1024,
    },
  },
  {
    name: 'Basic',
    slug: 'basic',
    price: {
      monthly: 9,
      yearly: 90,
    },
    priceId: {
      monthly: process.env.STRIPE_PRICE_ID_BASIC,
      yearly: process.env.STRIPE_PRICE_ID_BASIC_YEARLY,
    },
    features: [
      '50 projects',
      'Advanced analytics',
      'Email support',
      '10 GB storage',
      'API access',
    ],
    limits: {
      projects: 50,
      storage: 10240,
    },
  },
  {
    name: 'Pro',
    slug: 'pro',
    price: {
      monthly: 29,
      yearly: 290,
    },
    priceId: {
      monthly: process.env.STRIPE_PRICE_ID_PRO,
      yearly: process.env.STRIPE_PRICE_ID_PRO_YEARLY,
    },
    features: [
      'Unlimited projects',
      'Advanced analytics',
      'Priority support',
      '100 GB storage',
      'API access',
      'Custom integrations',
    ],
    limits: {
      projects: -1,
      storage: 102400,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    price: {
      monthly: 99,
      yearly: 990,
    },
    priceId: {
      monthly: process.env.STRIPE_PRICE_ID_ENTERPRISE,
      yearly: process.env.STRIPE_PRICE_ID_ENTERPRISE_YEARLY,
    },
    features: [
      'Unlimited everything',
      'Advanced analytics',
      '24/7 phone & email support',
      'Unlimited storage',
      'API access',
      'Custom integrations',
      'Dedicated account manager',
      'SLA guarantee',
    ],
    limits: {
      projects: -1,
      storage: -1,
    },
  },
]

export function getUserPlan(stripePriceId: string | null) {
  const plan = PLANS.find(
    (p) =>
      p.priceId.monthly === stripePriceId || p.priceId.yearly === stripePriceId
  )
  return plan || PLANS[0]
}

export function isSubscriptionActive(
  stripeCurrentPeriodEnd: Date | null
): boolean {
  if (!stripeCurrentPeriodEnd) return false
  return new Date(stripeCurrentPeriodEnd).getTime() + 86_400_000 > Date.now()
}
