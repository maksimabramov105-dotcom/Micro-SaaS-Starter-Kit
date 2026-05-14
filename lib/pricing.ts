export const PRICING_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: null,
    dailyLimit: 3,
    priceId: null,
    features: ['3 applications/day', '1 resume', 'Adzuna + RemoteOK jobs'],
  },
  {
    id: 'trial',
    name: 'Trial',
    price: 2.99,
    period: '14 days',
    dailyLimit: 10,
    priceId: process.env.STRIPE_PRICE_ID_TRIAL || null,
    features: ['10 applications/day', '3 resumes', 'All job boards', '14-day access'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19.99,
    period: 'month',
    dailyLimit: 25,
    priceId: process.env.STRIPE_PRICE_ID_PRO || null,
    features: ['25 applications/day', 'Unlimited resumes', 'LinkedIn autoapply', 'Priority support'],
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: 29.99,
    period: 'month',
    dailyLimit: 9999,
    priceId: process.env.STRIPE_PRICE_ID_UNLIMITED || null,
    features: ['Unlimited applications', 'Unlimited resumes', 'All platforms', 'API access'],
  },
] as const

export type PricingPlan = (typeof PRICING_PLANS)[number]

export function getPlanByPriceId(priceId: string | null | undefined): PricingPlan {
  return PRICING_PLANS.find((p) => p.priceId === priceId) ?? PRICING_PLANS[0]
}

export function getPlanById(id: string): PricingPlan {
  return PRICING_PLANS.find((p) => p.id === id) ?? PRICING_PLANS[0]
}
