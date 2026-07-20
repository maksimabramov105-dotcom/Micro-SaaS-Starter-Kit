import Link from 'next/link'
import { CheckCircle2, Globe, Inbox, ShieldCheck, FileCheck2 } from 'lucide-react'
import { PRICE, VISIBLE_PLANS, getMonthlyEquivalent } from '@/lib/pricing'
import { LaunchBanner } from '@/components/launch-banner'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { HeroDemo } from '@/components/hero-demo'
import { testimonials, replyScreenshots } from '@/lib/proof'

// ISR: regenerated hourly so proof/testimonial content stays fresh while
// the page stays fully server-rendered + indexable.
export const revalidate = 3600

// Self-referencing canonical for the homepage (resolved against metadataBase).
export const metadata = {
  title: 'ResumeAI — a resume built for the job you actually want',
  description:
    'Paste a job posting and get your resume rewritten for that exact role, plus a fit report. Verified applications, replies in one inbox. Free check.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'ResumeAI — a resume built for the job you actually want',
    description:
      'Your resume rewritten for one specific job, with a fit report showing what got you filtered out. Verified applications, replies in one inbox.',
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ResumeAI — a resume built for the job you actually want',
    description:
      'Your resume rewritten for one specific job, with a fit report. Verified applications, replies in one inbox.',
  },
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
    'AI resume builder that tailors your resume to each role, auto-applies where you are genuinely eligible, and verifies every submission.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro (monthly)', price: '19', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro (yearly)', price: '180', priceCurrency: 'USD' },
  ],
}

// Homepage pricing: show Free + the YEARLY plans by default so the first price a
// visitor sees is the better-value annual plan (HOMEPAGE_COPY.md §6). Kept as a
// static server-rendered list so prices stay in the raw HTML for SEO.
const HOMEPAGE_PLANS = VISIBLE_PLANS.filter(
  (p) => p.intervalKey === null || p.intervalKey === 'year',
)

export default async function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <LaunchBanner />

      <SiteHeader />

      {/* Hero — split layout: message left, product proof right (P2.9) */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          {/* Left — message + CTA */}
          <div className="text-center lg:text-left">
            <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-emerald-600">
              Tailored per role · verified submitted · replies in one inbox
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              A resume built for the job you actually want.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600 lg:mx-0 mx-auto">
              Paste a job posting and get your resume rewritten for <strong>that specific
              role</strong>, with a fit report showing what was getting you filtered out. Every
              application we send is <strong>confirmed by the employer&apos;s ATS</strong>, and
              every reply lands in <strong>one inbox</strong>. Optional auto-apply handles the
              volume &mdash; only where you&apos;re genuinely eligible.
            </p>

            {/* Two money paths + free signup, all ref-tagged for attribution */}
            <div className="mt-8 flex flex-col items-center gap-3 lg:items-start">
              <Link
                href="/ats-check?ref=home"
                className="rounded-lg bg-emerald-600 px-8 py-3 text-lg font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Check your resume against a job &mdash; free &rarr;
              </Link>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:justify-start">
                <Link
                  href="/resume-rescue?ref=home"
                  className="rounded-lg border-2 border-emerald-600 px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  Fix my resume for this job &mdash; {PRICE.rescue}
                </Link>
                <Link href="/login?ref=home" className="text-sm font-semibold text-slate-700 underline">
                  or start free
                </Link>
              </div>
              <p className="text-sm text-slate-600">
                No credit card to try · 30-day money-back guarantee on paid plans
              </p>
            </div>

            {/* Honest trust strip — no fabricated metrics */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-600 lg:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden="true" /> Only where you&apos;re eligible
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-brand" aria-hidden="true" /> Remote-first roles · AU/NZ/US/EU
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

      {/* Verified-submission proof (A4): no absolute counters — small numbers
          read as an empty room. The differentiator is VERIFIABILITY, so we
          link the live ledger instead. */}
      <section className="border-y border-slate-100 bg-emerald-50/40 px-4 py-12">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Every application, verified
          </p>
          <p className="max-w-2xl text-slate-700">
            We never mark a job &ldquo;applied&rdquo; unless the employer&apos;s ATS actually
            acknowledged the submission — and we publish the live ledger so you can check us.
            No inflated counters, no &ldquo;we clicked a button&rdquo; applications.
          </p>
          <Link
            href="/proof"
            className="mt-1 inline-block rounded-lg border-2 border-emerald-700 px-5 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            See the live verified ledger &rarr;
          </Link>
        </div>
      </section>

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
                body: 'Built for people applying across borders. We prioritize remote-first roles at 160+ companies we can actually submit to across AU, NZ, US and EU — not just US LinkedIn.',
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
                  'Choose your target regions (AU/NZ/US/EU) and job types. We find matching openings.',
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

      {/* Comparison — the full, maintained table lives on /compare (10 tools).
          The homepage carried a divergent 3-tool copy that drifted out of sync,
          so we link the single source instead (E2). */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-2 text-3xl font-bold text-slate-900">Why we&apos;re different</h2>
          <p className="mx-auto mb-8 max-w-2xl text-slate-600">
            Most auto-apply tools brag about volume — and quietly send applications you
            can&apos;t win, many of which never actually submit. We do the opposite: apply only
            where you&apos;re eligible, prove each one went through, and put every reply in your
            inbox.
          </p>
          <Link
            href="/compare"
            className="inline-block rounded-lg border-2 border-slate-300 px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50"
          >
            Compare us against 10 job-search tools &rarr;
          </Link>
        </div>
      </section>

      {/* Mid-page money paths — same two offers as the hero, for visitors who
          scrolled past it (E2). */}
      <section className="border-y border-slate-100 bg-emerald-50/40 px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-3 text-2xl font-bold text-slate-900">
            Start with the job you want right now
          </h2>
          <p className="mb-6 text-slate-700">
            Paste a posting and see your fit score free. If it needs work, we&apos;ll rewrite your
            resume for that exact role in minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/ats-check?ref=home-mid"
              className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700"
            >
              Check your resume against a job — free
            </Link>
            <Link
              href="/resume-rescue?ref=home-mid"
              className="rounded-lg border-2 border-emerald-600 px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Fix my resume for this job — {PRICE.rescue}
            </Link>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            or{' '}
            <Link href="/login?ref=home-mid" className="underline">
              start free — 3 applications/day
            </Link>
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
          <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
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
          Stop spraying. Start applying where you can actually win.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600">
          Start free — 3 applications a day, no credit card. Every one eligibility-checked, tailored,
          and verified submitted. Upgrade when you see confirmed applications and replies land in your inbox.
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

      {/* Founder note (A4 trust block) — a real human answers for this product. */}
      <section className="border-t border-slate-100 bg-white px-4 py-14">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <div
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-slate-200 text-2xl font-bold text-slate-600"
          >
            MA
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Built by Maxim Abramov</h2>
            <p className="mt-1 text-sm text-slate-600">
              I built ResumeAI after watching auto-apply tools spray applications that never
              reached a human — and honest applicants lose to the noise. This product only sends
              applications you can actually win, and proves every single one was delivered.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Questions? Email me:{' '}
              <a href="mailto:support@resumeai-bot.ru" className="font-medium underline">
                support@resumeai-bot.ru
              </a>{' '}
              — answered within 24 hours.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
