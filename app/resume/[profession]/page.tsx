// app/resume/[profession]/page.tsx — "{Profession} resume" guides.
//
// This was the oldest programmatic template and the last one still shipping as a
// scaffold: inline-styled <article> with no site navigation, no CTA of any kind,
// ~235 words, and pre-pivot claims ("auto-apply to matching remote-first roles at
// 160+ companies") that #197 removed everywhere else. Twenty indexed pages that
// could not convert anyone and undercut the positioning of every page that could.
//
// Copy lives in lib/seo/professions.ts so the thin-content guard asserts against
// the same builders this page renders.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import {
  PROFESSIONS,
  corpusRole,
  getProfession,
  professionBody,
  professionFaq,
  professionMeta,
} from '@/lib/seo/professions'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.com'

export function generateStaticParams() {
  return PROFESSIONS.map((p) => ({ profession: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ profession: string }>
}): Promise<Metadata> {
  const { profession } = await params
  const p = getProfession(profession)
  if (!p) return {}
  const meta = professionMeta(p)
  const url = `${SITE}/resume/${p.slug}`
  return {
    ...meta,
    alternates: { canonical: url },
    openGraph: { ...meta, url, siteName: 'ResumeAI', type: 'article' },
    twitter: { card: 'summary_large_image', ...meta },
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ profession: string }>
}) {
  const { profession } = await params
  const p = getProfession(profession)
  if (!p) notFound()

  const url = `${SITE}/resume/${p.slug}`
  const body = professionBody(p)
  const faq = professionFaq(p)
  const role = corpusRole(p)
  const related = PROFESSIONS.filter((x) => x.slug !== p.slug).slice(0, 8)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: professionMeta(p).title,
        mainEntityOfPage: url,
        author: { '@type': 'Organization', name: 'ResumeAI' },
        publisher: { '@type': 'Organization', name: 'ResumeAI' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  }

  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-slate-500">
          <Link href="/" className="hover:underline">
            Home
          </Link>{' '}
          &rsaquo; <span className="text-slate-700">{p.name} resume</span>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {p.name} resume: what passes ATS screening
        </h1>

        <div className="mt-6 space-y-5 text-lg leading-relaxed text-slate-700">
          {body.slice(0, 2).map((para) => (
            <p key={para.slice(0, 40)}>{para}</p>
          ))}
        </div>

        <h2 className="mt-10 text-2xl font-bold text-slate-900">
          {role ? `Keywords from real ${p.name} postings` : `Keywords that carry weight`}
        </h2>
        <div className="mt-4 space-y-5 text-lg leading-relaxed text-slate-700">
          {body.slice(2, role ? 4 : 3).map((para) => (
            <p key={para.slice(0, 40)}>{para}</p>
          ))}
        </div>

        {role && (
          <p className="mt-4 text-slate-600">
            The full list, with how to use each one, is on{' '}
            <Link
              href={`/resume-keywords/${role.slug}`}
              className="font-medium text-emerald-700 hover:underline"
            >
              resume keywords for {role.role} roles
            </Link>
            .
          </p>
        )}

        <h2 className="mt-10 text-2xl font-bold text-slate-900">Format and eligibility</h2>
        <div className="mt-4 space-y-5 text-lg leading-relaxed text-slate-700">
          {body.slice(role ? 4 : 3, role ? 5 : 4).map((para) => (
            <p key={para.slice(0, 40)}>{para}</p>
          ))}
        </div>

        <h2 className="mt-10 text-2xl font-bold text-slate-900">Check it against a real job</h2>
        <div className="mt-4 space-y-5 text-lg leading-relaxed text-slate-700">
          {body.slice(role ? 5 : 4).map((para) => (
            <p key={para.slice(0, 40)}>{para}</p>
          ))}
        </div>

        <div className="mt-6">
          <Link
            href={`/ats-check?ref=resume-${p.slug}`}
            className="inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700"
          >
            Check your {p.name} resume against a job — free &rarr;
          </Link>
        </div>

        <div className="mt-10">
          <RescueCtaBlock context={`${p.name} role`} refTag={`resume-${p.slug}`} />
        </div>

        <h2 className="mt-12 text-2xl font-bold text-slate-900">Frequently asked questions</h2>
        <dl className="mt-4 space-y-6">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-slate-900">{f.q}</dt>
              <dd className="mt-1 leading-relaxed text-slate-700">{f.a}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <p className="font-medium text-slate-700">Other roles</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {related.map((x) => (
              <Link key={x.slug} href={`/resume/${x.slug}`} className="hover:underline">
                {x.name}
              </Link>
            ))}
          </p>
          <p className="mt-4">
            <Link href="/proof" className="hover:underline">
              See the verified application ledger
            </Link>{' '}
            — every submission we count is confirmed by the employer&apos;s ATS.
          </p>
        </div>
      </article>

      <SiteFooter />
    </main>
  )
}
