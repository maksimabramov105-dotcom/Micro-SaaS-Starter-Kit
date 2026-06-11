import Link from 'next/link'
import { CheckCircle2, Globe, Inbox, ShieldCheck, FileCheck2 } from 'lucide-react'
import { PRICING_PLANS, getMonthlyEquivalent } from '@/lib/pricing'
import { LaunchBanner } from '@/components/launch-banner'
import { Logo } from '@/components/logo'
import { HeroDemo } from '@/components/hero-demo'
import { prisma } from '@/lib/prisma'
import { testimonials, replyScreenshots } from '@/lib/proof'

// ISR: regenerated hourly so the outcomes band shows real, fresh numbers while
// the page stays fully server-rendered + indexable.
export const revalidate = 3600

// Real funnel proof (D2) — aggregate, anonymized. Only shown once there's a
// meaningful volume so early/empty numbers never undersell the product.
// Single source of truth for the homepage proof counters. Definitions are
// EXACT and must match the caption:
//   sent      = our system completed the application (JobApplication SUBMITTED+)
//   confirmed = the employer's ATS acknowledged receipt (ApplicationEvent 'confirmed')
async function getOutcomes(): Promise<{
  sent: number
  sentThisWeek: number
  confirmed: number
} | null> {
  try {
    const SENT = ['SUBMITTED', 'INTERVIEW', 'REJECTED', 'OFFER'] as const
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [sent, sentThisWeek, confirmed] = await Promise.all([
      prisma.jobApplication.count({ where: { status: { in: [...SENT] } } }),
      prisma.jobApplication.count({ where: { status: { in: [...SENT] }, createdAt: { gte: weekAgo } } }),
      prisma.applicationEvent.count({ where: { type: 'confirmed' } }),
    ])
    if (sent < 200) return null // hold until the number is impressive
    return { sent, sentThisWeek, confirmed }
  } catch {
    return null
  }
}

// SoftwareApplication structured data for rich results (HOMEPAGE_COPY.md §9).
// No aggregateRating until we have real reviews — never fake ratings.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ResumeAI-Bot',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://resumeai-bot.ru',
  description:
    'AI resume builder that tailors your resume to each role and auto-applies to jobs across 50+ countries.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro (monthly)', price: '19.99', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro (yearly)', price: '199', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Unlimited (monthly)', price: '29.99', priceCurrency: 'USD' },
  ],
}

// Homepage pricing: show Free + the YEARLY plans by default so the first price a
// visitor sees is the better-value annual plan (HOMEPAGE_COPY.md §6). Kept as a
// static server-rendered list so prices stay in the raw HTML for SEO.
const HOMEPAGE_PLANS = PRICING_PLANS.filter(
  (p) => p.intervalKey === null || p.intervalKey === 'year',
)

export default async function HomePage() {
  const outcomes = await getOutcomes()
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <LaunchBanner />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" aria-label="ResumeAI home">
            <Logo />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="#how" className="hidden text-sm text-slate-600 hover:text-slate-900 sm:block">
              How it works
            </Link>
            <Link href="#pricing" className="text-sm text-slate-600 hover:text-slate-900">
              Pricing
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — split layout: message left, product proof right (P2.9) */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          {/* Left — message + CTA */}
          <div className="text-center lg:text-left">
            <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-emerald-600">
              AI resume builder + auto-apply · 50+ countries
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Your job search, on autopilot &mdash; only where you&apos;re eligible.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600 lg:mx-0 mx-auto">
              We tailor your resume to each role and auto-apply across 50+ countries &mdash; remote,
              your authorized countries, sponsorship-aware &mdash; then capture every reply in one
              inbox. Built for applying across borders, not just US LinkedIn.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 lg:items-start">
              <Link
                href="/login"
                className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Start free &mdash; 3 applications/day &rarr;
              </Link>
              <p className="text-sm text-slate-600">
                No credit card · 30-day money-back guarantee on paid plans
              </p>
            </div>

            {/* Honest trust strip — no fabricated metrics */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-600 lg:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden="true" /> Only where you&apos;re eligible
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-brand" aria-hidden="true" /> Remote &amp; 50+ countries
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Inbox className="h-4 w-4 text-brand" aria-hidden="true" /> Confirmed by the ATS — no fake &ldquo;applied&rdquo;
              </span>
            </div>
          </div>

          {/* Right — animated product proof */}
          <div className="flex justify-center lg:justify-end">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* Real funnel proof (D2) — only renders once volume is meaningful. */}
      {outcomes && (
        <section className="border-y border-slate-100 bg-emerald-50/40 px-4 py-12">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Live activity on ResumeAI-Bot
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-4">
              <div>
                <div className="text-4xl font-bold text-slate-900">{outcomes.sent.toLocaleString()}</div>
                <div className="text-sm text-slate-600">applications sent</div>
                {outcomes.sentThisWeek > 0 && (
                  <div className="mt-0.5 text-xs font-medium text-emerald-700">
                    +{outcomes.sentThisWeek.toLocaleString()} this week
                  </div>
                )}
              </div>
              {outcomes.confirmed > 0 && (
                <div>
                  <div className="text-4xl font-bold text-slate-900">{outcomes.confirmed.toLocaleString()}</div>
                  <div className="text-sm text-slate-600">confirmed by employer ATS</div>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Live totals across all users, updated hourly. &ldquo;Sent&rdquo; means our system
              completed the application; &ldquo;confirmed&rdquo; means the employer&apos;s ATS
              acknowledged receipt.
            </p>
          </div>
        </section>
      )}

      {/* Real testimonials / reply screenshots (D2). Empty by default — we never
          ship fabricated proof. Fill lib/proof.ts with genuine content. */}
      {(testimonials.length > 0 || replyScreenshots.length > 0) && (
        <section className="border-b border-slate-100 bg-white px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-10 text-center text-3xl font-bold text-slate-900">Real replies, real results</h2>
            {replyScreenshots.length > 0 && (
              <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {replyScreenshots.map((s) => (
                  <figure key={s.src} className="overflow-hidden rounded-xl border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt={s.alt} className="w-full" />
                    {s.caption && <figcaption className="px-3 py-2 text-xs text-slate-600">{s.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
            {testimonials.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {testimonials.map((t) => (
                  <blockquote key={t.name + t.quote} className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                    <p className="text-sm text-slate-700">&ldquo;{t.quote}&rdquo;</p>
                    <footer className="mt-3 text-xs font-medium text-slate-900">
                      {t.name} <span className="font-normal text-slate-600">— {t.role}</span>
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Why ResumeAI-Bot — honest value/trust block (HOMEPAGE_COPY.md §4).
          NOTE: this replaces the testimonials slot. We are NOT shipping
          fabricated customer quotes — fake testimonials are illegal (FTC 2024
          fake-reviews rule, EU UCPD) and erode the trust this page is built on.
          Swap in a real-testimonials section here once you have genuine quotes. */}
      <section className="border-y border-slate-100 bg-white px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-3xl font-bold text-slate-900">
            Why job seekers choose ResumeAI-Bot
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                Icon: ShieldCheck,
                title: 'Only jobs you can actually get',
                body: "Other tools blast US postings and answer “authorized to work? — yes” for everyone, so you get auto-rejected. We check your work authorization, visa-sponsorship needs and remote-eligibility BEFORE applying — and answer honestly.",
              },
              {
                Icon: Globe,
                title: 'Remote-first & global',
                body: 'Built for people applying across borders. We prioritize remote and internationally-friendly roles across 50+ countries — not just US LinkedIn.',
              },
              {
                Icon: FileCheck2,
                title: 'A resume tuned to every job',
                body: "We don't blast one generic resume. Our AI rewrites yours per role so it passes the ATS and reads like you wrote it for that company.",
              },
              {
                Icon: Inbox,
                title: 'We track the replies',
                body: "Most tools fire and forget. We capture employer replies in one inbox, and only mark a job “applied” after the ATS actually confirms it — so your dashboard is honest.",
              },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft">
                  <c.Icon className="h-5 w-5 text-brand-deep" aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-base font-semibold text-slate-900">{c.title}</h3>
                <p className="text-sm text-slate-600">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3-step flow (HOMEPAGE_COPY.md §3) */}
      <section id="how" className="bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900">How it works</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Add your details',
                description:
                  'Upload an existing resume or answer a few questions. Our AI learns your experience.',
              },
              {
                step: '2',
                title: 'Pick your countries & roles',
                description:
                  'Choose from 50+ countries and the job types you want. We find matching openings.',
              },
              {
                step: '3',
                title: 'We apply for you',
                description:
                  'The AI tailors your resume to each role and submits applications across the top job boards. You track everything from one dashboard.',
              },
            ].map(({ step, title, description }) => (
              <div
                key={step}
                className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                  {step}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="text-sm text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison (HOMEPAGE_COPY.md §5). Competitor facts verified Jun 2026:
          Sonara shut down Feb 2024 (since acquired by BOLD); LazyApply is a
          one-time "lifetime" purchase from $99, not an annual fee. */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-2 text-center text-3xl font-bold text-slate-900">Why we&apos;re different</h2>
          <p className="mb-8 text-center text-slate-600">
            Most auto-apply tools are US / LinkedIn-only and assume you can work anywhere.
            We only apply where you&apos;re actually eligible — and track the replies.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-3 pr-4 font-medium"></th>
                  <th className="py-3 px-4 font-bold text-emerald-700">ResumeAI-Bot</th>
                  <th className="py-3 px-4 font-medium">Sonara</th>
                  <th className="py-3 px-4 font-medium">LazyApply</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {[
                  ['Eligibility-aware (only applies where you can work)', '✓', '✕', '✕'],
                  ['Captures employer replies in an inbox', '✓', '✕', '✕'],
                  ['Countries covered', '50+', 'shut down (2024)', 'US-focused'],
                  ['AI resume per role', '✓', 'limited', 'limited'],
                  ['Free tier', '✓ 3/day', '✕', '✕'],
                  ['30-day money-back', '✓', '—', '✕'],
                  ['Price', '$19.99/mo', '—', 'from $99 one-time'],
                ].map(([label, ...cells]) => (
                  <tr key={label} className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium text-slate-900">{label}</td>
                    {cells.map((c, i) => (
                      <td
                        key={i}
                        className={`py-3 px-4 ${i === 0 ? 'font-semibold text-emerald-700' : ''}`}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-sm text-slate-600">
            Sonara shut down in 2024 — ResumeAI-Bot is a still-running alternative that covers more
            countries.
          </p>
        </div>
      </section>

      {/* Pricing (HOMEPAGE_COPY.md §6 — annual shown by default) */}
      <section id="pricing" className="bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-3xl font-bold text-slate-900">
            Simple, transparent pricing
          </h2>
          <p className="mb-12 text-center text-slate-600">
            Start for free. Upgrade when you need more power — 30-day money-back guarantee on every
            paid plan.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {HOMEPAGE_PLANS.map((plan) => {
              const isPro = plan.id === 'pro_yearly'
              const isYearly = plan.intervalKey === 'year'
              const monthlyEquiv = isYearly ? getMonthlyEquivalent(plan) : null
              return (
                <div
                  key={plan.id}
                  className={`rounded-xl border p-6 ${
                    isPro
                      ? 'border-emerald-500 bg-emerald-50 shadow-md'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  {isPro && (
                    <div className="mb-3 inline-block rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                      Most popular
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold text-slate-900">
                      {plan.price === 0 ? 'Free' : `$${plan.price}`}
                    </span>
                    {plan.period && (
                      <span className="mb-1 text-sm text-slate-600">/ {plan.period}</span>
                    )}
                  </div>
                  {monthlyEquiv && (
                    <p className="mt-1 text-xs text-slate-600">
                      ≈ ${monthlyEquiv.toFixed(2)}/mo, billed annually
                    </p>
                  )}
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="text-emerald-500">&#10003;</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/login"
                    className={`mt-6 block w-full rounded-lg px-4 py-2 text-center text-sm font-semibold transition-colors ${
                      isPro
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Get started
                  </Link>
                </div>
              )
            })}
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            See monthly pricing on the{' '}
            <Link href="/pricing" className="text-emerald-600 underline underline-offset-2">
              full pricing page
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Final CTA band (HOMEPAGE_COPY.md §8) */}
      <section className="px-4 py-20 text-center">
        <h2 className="mx-auto max-w-3xl text-3xl font-bold text-slate-900">
          Your next job could be in any of 50+ countries. Let&apos;s go find it.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600">
          Start free — 3 applications a day, no credit card. Upgrade when you see confirmed
          applications and replies land in your inbox.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Start applying free &rarr;
          </Link>
          <p className="mt-3 text-sm text-slate-600">
            30-day money-back guarantee on all paid plans.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-slate-50 px-4 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-sm text-slate-600 sm:flex-row sm:justify-between">
          <span>&copy; {new Date().getFullYear()} ResumeAI. All rights reserved.</span>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/faq" className="hover:text-slate-900">
              FAQ
            </Link>
            <Link href="/refund-policy" className="hover:text-slate-900">
              Refund Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-900">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy
            </Link>
            <Link href="/contact" className="hover:text-slate-900">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
