import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrAssignVariant } from '@/lib/experiments'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { PricingCards } from '@/components/pricing-cards'
import { LaunchBanner } from '@/components/launch-banner'
import { VISIBLE_PLANS } from '@/lib/pricing'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata = {
  title: 'Pricing — ResumeAI',
  description: 'Simple, transparent pricing with a 30-day money-back guarantee. No risk.',
  alternates: { canonical: `${SITE}/pricing` },
  openGraph: {
    title: 'Pricing — ResumeAI',
    description:
      'Start free. Pro is $19/month ($15/mo billed annually): unlimited tailoring, verified auto-applications, reply inbox.',
    url: `${SITE}/pricing`,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricing — ResumeAI',
    description: 'Start free. Pro $19/month, or $15/mo billed annually. 30-day money-back guarantee.',
  },
}

// Product/Offer JSON-LD built from the canonical plan list (monthly tiers).
const pricingJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'ResumeAI-Bot',
  description: 'AI resume builder + auto-apply to remote-first roles at 160+ companies (AU/NZ/US/EU).',
  brand: { '@type': 'Brand', name: 'ResumeAI-Bot' },
  offers: VISIBLE_PLANS.filter((p) => p.intervalKey !== 'year').map((p) => ({
    '@type': 'Offer',
    name: `${p.name} plan`,
    price: p.price,
    priceCurrency: 'USD',
    url: `${SITE}/pricing`,
    availability: 'https://schema.org/InStock',
  })),
}

// Headline copy for each pricing_headline_v1 variant
const HEADLINE = {
  control: {
    h1: 'Simple, Transparent Pricing',
    sub: 'Start free. Upgrade when you need more applications.',
  },
  guarantee: {
    h1: 'Land your next job in 30 days — or your money back.',
    sub: 'Try Pro or Unlimited risk-free. If you don\'t get interviews, we refund you in full.',
  },
}

export default async function PricingPage() {
  const session = await getServerSession(authOptions)
  const variant = await getOrAssignVariant('pricing_headline_v1', session?.user?.id)
  const copy = HEADLINE[variant as keyof typeof HEADLINE] ?? HEADLINE.control

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd) }}
      />
      <LaunchBanner />
      <SiteHeader />
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="mb-12 text-center">
              <h1 className="mb-4 text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl">
                {copy.h1}
              </h1>
              <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                {copy.sub}
              </p>
            </div>

            {/* 30-day money-back guarantee banner */}
            <div className="mx-auto mb-10 flex max-w-2xl items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4 dark:border-green-800 dark:bg-green-950">
              <span className="text-2xl" aria-hidden="true">🛡️</span>
              <div>
                <p className="font-semibold text-green-900 dark:text-green-100">
                  30-day money-back guarantee
                </p>
                <p className="text-sm text-green-800 dark:text-green-200">
                  30-day money-back guarantee, no questions asked.{' '}
                  <a href="/refund-policy" className="underline underline-offset-2 hover:opacity-80">
                    See policy →
                  </a>
                </p>
              </div>
            </div>

            <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-emerald-700 dark:text-emerald-300">
              🚀 Launch week: enter code <strong className="font-mono">LAUNCH40</strong> at checkout for{' '}
              <strong>40% off your first year</strong> (ends June 8).
            </p>

            <PricingCards />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
