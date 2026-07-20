/**
 * /resume-rescue — the $4.99 tripwire landing page (Revenue Sprint A2).
 *
 * One job: convert a visitor with a specific job posting in hand into a
 * $4.99 purchase. No signup wall — guest checkout, account auto-created.
 */
import { Navbar } from '@/components/navbar'
import { RescueForm } from '@/components/rescue-form'
import { PRICE, RESCUE_PRICE_USD } from '@/lib/pricing'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata = {
  title: `AI Resume Rescue — tailored for one job, ${PRICE.rescue}`,
  description:
    'Paste a job posting, get your resume rewritten for it plus a fit report: score, missing keywords, concrete fixes. Delivered in minutes or refunded.',
  alternates: { canonical: `${SITE}/resume-rescue` },
}

// Product + Offer structured data (A3): the tripwire is a real product with a
// real price — let search engines show it that way.
const rescueJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'AI Resume Rescue',
  description:
    'Your resume rewritten and tailored for one specific job posting, plus a fit report with score breakdown, missing ATS keywords, and concrete fixes.',
  brand: { '@type': 'Brand', name: 'ResumeAI' },
  offers: {
    '@type': 'Offer',
    price: RESCUE_PRICE_USD,
    priceCurrency: 'USD',
    url: `${SITE}/resume-rescue`,
    availability: 'https://schema.org/InStock',
  },
}

const STEPS = [
  {
    title: '1. Paste the job',
    body: 'The title and description of the role you actually want.',
  },
  {
    title: '2. Add your resume',
    body: 'Paste the text or upload the PDF you apply with today.',
  },
  {
    title: '3. Get the rescue',
    body: 'A rewritten, tailored resume + a fit report — typically in under 5 minutes.',
  },
]

const INCLUDED = [
  'Your resume rewritten for this exact job (honest — nothing invented)',
  'Fit score with a transparent breakdown of how it was computed',
  'ATS keywords the job asks for that your resume is missing',
  'Concrete fixes, prioritized — not generic advice',
  'All 5 PDF templates unlocked for your rescued resume',
  'Auto-refund if generation fails — you never pay for nothing',
]

export default function ResumeRescuePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(rescueJsonLd) }}
      />
      <Navbar />
      <main className="flex-1">
        <section className="w-full py-12 md:py-20">
          <div className="container mx-auto max-w-5xl px-4">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="mb-4 text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                Found the job you want?
                <br />
                Send a resume built for it.
              </h1>
              <p className="mb-2 text-lg text-muted-foreground">
                Paste the posting, get your resume rewritten for that exact role — plus a
                report showing why you were getting filtered out.
              </p>
              <p className="mb-8 text-lg font-semibold">
                {PRICE.rescue} one-time. No subscription. Delivered in minutes.
              </p>
            </div>

            <div className="mx-auto mb-12 grid max-w-3xl gap-4 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.title} className="rounded-lg border p-4">
                  <div className="mb-1 font-semibold">{s.title}</div>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>

            <div className="mx-auto grid max-w-4xl gap-10 md:grid-cols-[1fr_320px]">
              <RescueForm />
              <aside>
                <h2 className="mb-3 text-lg font-semibold">What you get</h2>
                <ul className="space-y-2 text-sm">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden className="text-green-600">
                        ✓
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-xs text-muted-foreground">
                  Payments by Stripe. 30-day money-back guarantee on everything we sell —{' '}
                  <a href="/refund-policy" className="underline">
                    refund policy
                  </a>
                  .
                </p>
              </aside>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
