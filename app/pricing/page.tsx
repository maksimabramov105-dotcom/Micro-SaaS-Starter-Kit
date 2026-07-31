import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { PricingCards } from '@/components/pricing-cards'
import { LaunchBanner } from '@/components/launch-banner'
import { PRICE, VISIBLE_PLANS } from '@/lib/pricing'
import { PROMO, isPromoActive, promoEndLabel } from '@/lib/promo'
import { VariantScript, ExposureBeacon } from '@/components/ab-script'
import { getPricingExperiment } from '@/lib/pricing-experiment.server'
import {
  PRICING_CONTROL,
  PRICING_COOKIE,
  PRICING_EXPERIMENT,
  PRICING_SWAPS,
} from '@/lib/pricing-experiment'

// Static shell + hourly ISR. /pricing used to be server-rendered on demand
// purely because it assigned an A/B variant server-side, and that cost it every
// bit of static caching: Lighthouse 72 and LCP 5.4 s on the page that takes the
// money, against 99 on the landing page. Assignment now happens in the browser
// (lib/ab.ts) and the page is static again.
export const revalidate = 3600

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.com'

export const metadata = {
  title: 'Pricing — ResumeAI',
  description: 'Simple, transparent pricing with a 30-day money-back guarantee. No risk.',
  alternates: { canonical: `${SITE}/pricing` },
  openGraph: {
    title: 'Pricing — ResumeAI',
    description:
      `Start free. Pro is ${PRICE.proMonthly}/month (${PRICE.proYearlyPerMo}/mo billed annually): unlimited tailoring, verified auto-applications, reply inbox.`,
    url: `${SITE}/pricing`,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pricing — ResumeAI',
    description: `Start free. Pro ${PRICE.proMonthly}/month, or ${PRICE.proYearlyPerMo}/mo billed annually. 30-day money-back guarantee.`,
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

export default async function PricingPage() {
  const experiment = await getPricingExperiment()

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
              {/* suppressHydrationWarning is load-bearing, not cosmetic: the inline
                  script below rewrites this text before hydration, and without
                  it React reconciles the node back to the server-rendered
                  control during hydration. Observed live on 2026-07-31 — the
                  variant was assigned and the cookie set, and the visitor still
                  read the control headline. */}
              <h1
                id="pricing-headline"
                suppressHydrationWarning
                className="mb-4 text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl"
              >
                {PRICING_CONTROL.h1}
              </h1>
              <p
                id="pricing-subhead"
                suppressHydrationWarning
                className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400"
              >
                {PRICING_CONTROL.sub}
              </p>
              <VariantScript
                config={experiment}
                experimentKey={PRICING_EXPERIMENT}
                cookieName={PRICING_COOKIE}
                swaps={PRICING_SWAPS}
              />
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

            {/* Data-driven from lib/promo.ts and gated on isPromoActive, so an
                expired offer can never render. This block previously hardcoded
                "LAUNCH40 ... (ends June 8)" and was still on the live page in
                late July — a dated offer past its date reads as abandoned (or
                worse, as a dark pattern). Never hardcode the code or the date. */}
            {isPromoActive() && (
              <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-emerald-700 dark:text-emerald-300">
                🚀 Enter code <strong className="font-mono">{PROMO.code}</strong> at checkout for{' '}
                <strong>{PROMO.discountLabel}</strong> (ends {promoEndLabel()}).
              </p>
            )}

            <PricingCards />
          </div>
        </section>
      </main>
      <SiteFooter />
      <ExposureBeacon
        config={experiment}
        experimentKey={PRICING_EXPERIMENT}
        page="/pricing"
      />
    </div>
  )
}
