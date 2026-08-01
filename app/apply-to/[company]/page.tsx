// app/apply-to/[company]/page.tsx — "How to apply to jobs at {Company}" (B2).
// Static-rendered for all curated companies; the live open-roles count comes
// from the scraper cache (JobListing) and refreshes via ISR, so pages stay
// current automatically as the existing crons run.
import type { Metadata } from 'next'
import { relatedBySlug } from '@/lib/seo/related'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import {
  APPLY_COMPANIES,
  ATS_GUIDE,
  getApplyCompany,
  applyToMeta,
  applyToFaq,
  applyToFollowup,
} from '@/lib/seo/apply-companies'
import { getOpenRolesSnapshot, companyRoles } from '@/lib/seo/company-roles'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.com'

export const revalidate = 21600 // 6h — keeps the open-roles count fresh

export function generateStaticParams() {
  return APPLY_COMPANIES.map((c) => ({ company: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ company: string }>
}): Promise<Metadata> {
  const { company } = await params
  const c = getApplyCompany(company)
  if (!c) return {}
  return {
    ...applyToMeta(c),
    alternates: { canonical: `${SITE}/apply-to/${c.slug}` },
  }
}

export default async function ApplyToCompanyPage({
  params,
}: {
  params: Promise<{ company: string }>
}) {
  const { company } = await params
  const c = getApplyCompany(company)
  if (!c) notFound()

  // G1: one snapshot of the scraper cache adds a live open-role list to
  // companies that currently have postings. We do NOT 404 companies with 0
  // cached roles: their page still carries 300+ words of unique, per-company
  // editorial (the thin-page guard proves it), and the crawler pulls supply in
  // bumps — hiding a page the day its board happens to read 0 would churn ~120
  // indexed URLs in and out of the index. The role list is a bonus, not a gate.
  const snap = await getOpenRolesSnapshot()
  const openRoles = companyRoles(snap, c.slug)
  const roles = openRoles?.count ?? 0

  const guide = ATS_GUIDE[c.ats]
  // Rotating window, not slice(0,6): taking the first six siblings gave every
  // sibling link to the alphabetically earliest companies and left 80% of these
  // pages with only the hub linking to them.
  const related = relatedBySlug(APPLY_COMPANIES, c.slug, 6)

  const faq = applyToFaq(c)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Apply-to guides', item: `${SITE}/apply-to` },
          { '@type': 'ListItem', position: 2, name: c.name, item: `${SITE}/apply-to/${c.slug}` },
        ],
      },
      {
        '@type': 'HowTo',
        name: `How to apply to jobs at ${c.name}`,
        step: [
          { '@type': 'HowToStep', name: 'Open the official board', text: `Go to ${c.boardUrl} and pick the role that genuinely matches your experience.` },
          { '@type': 'HowToStep', name: 'Tailor your resume', text: `Rewrite your resume for that specific posting — mirror its requirements truthfully.` },
          { '@type': 'HowToStep', name: `Complete the ${c.atsName} form`, text: `Fill every field carefully; screening questions are machine-filtered before human review.` },
          { '@type': 'HowToStep', name: 'Track the confirmation', text: `Keep the ${c.atsName} confirmation email so you can follow up in 7–10 days.` },
        ],
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
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p style={{ fontSize: 14 }}>
        <Link href="/apply-to">Apply-to guides</Link> › {c.name}
      </p>
      <h1>How to apply to jobs at {c.name} (2026)</h1>
      <p>
        {c.name} runs its hiring on <strong>{c.atsName}</strong>, which means every application
        you send goes through the same form, the same parsing, and the same screening rules —
        and knowing how that pipeline works is the difference between being read and being
        filtered. The official board is{' '}
        <a href={c.boardUrl} rel="nofollow noopener" target="_blank">
          {c.boardUrl.replace('https://', '')}
        </a>
        {roles > 0 ? (
          <>
            {' '}— our crawler currently has <strong>{roles}</strong> open {c.name}{' '}
            {roles === 1 ? 'role' : 'roles'} indexed there (refreshed automatically).
          </>
        ) : (
          <> — always apply at the source rather than an aggregator re-post.</>
        )}
      </p>

      {openRoles && openRoles.sample.length > 0 && (
        <>
          <h2>Open {c.name} roles right now</h2>
          <p>
            A live sample from our crawler
            {openRoles.remoteCount > 0 ? (
              <>
                {' '}— <strong>{openRoles.remoteCount}</strong> of the{' '}
                {roles === 1 ? 'role' : `${roles} roles`} we currently index{' '}
                {openRoles.remoteCount === 1 ? 'is' : 'are'} remote-eligible.
              </>
            ) : (
              <> — check each posting for its location and remote policy.</>
            )}
          </p>
          <ul>
            {openRoles.sample.map((r) => (
              <li key={r.url}>
                <a href={r.url} rel="nofollow noopener" target="_blank">
                  {r.title}
                </a>
                {r.remote ? ' · Remote' : r.location ? ` · ${r.location}` : ''}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 14 }}>
            Apply on the official board rather than an aggregator re-post — source postings
            close first, and {c.atsName} tracks where the application came from.
          </p>
        </>
      )}

      <h2>What the {c.atsName} application actually looks like</h2>
      <p>{guide.form.replaceAll('{company}', c.slug)}</p>

      <h2>Tailoring your resume for {c.name}</h2>
      <ul>
        {guide.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
        <li>
          Read the posting twice and mirror its top requirements in your summary and first
          bullets — truthfully. Recruiters scan the top third of page one before deciding
          anything.
        </li>
      </ul>

      <h2>After you apply</h2>
      <p>{applyToFollowup(c)}</p>

      <RescueCtaBlock context={`a ${c.name} posting`} refTag="seo-apply-to" />

      <h2>Frequently asked questions</h2>
      {faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <hr style={{ margin: '2rem 0' }} />
      <p style={{ fontSize: 14 }}>
        More {c.atsName} companies:{' '}
        {related.map((x) => (
          <Link key={x.slug} href={`/apply-to/${x.slug}`} style={{ marginRight: 8 }}>
            {x.name}
          </Link>
        ))}
        · <Link href="/apply-to">All companies</Link>
      </p>
      <p style={{ fontSize: 14 }}>
        Keep going: <Link href="/ats-check">free ATS fit check</Link> ·{' '}
        <Link href="/resume-keywords">resume keywords by role</Link> ·{' '}
        <Link href="/compare">how we compare</Link> ·{' '}
        <Link href="/alternatives/teal">tool alternatives</Link> ·{' '}
        <Link href="/blog">what actually reaches a human</Link>
      </p>
    </article>
      <SiteFooter />
    </>
  )
}
