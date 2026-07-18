// app/apply-to/[company]/page.tsx — "How to apply to jobs at {Company}" (B2).
// Static-rendered for all curated companies; the live open-roles count comes
// from the scraper cache (JobListing) and refreshes via ISR, so pages stay
// current automatically as the existing crons run.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import {
  APPLY_COMPANIES,
  ATS_GUIDE,
  getApplyCompany,
  jobUrlMatcher,
} from '@/lib/seo/apply-companies'
import { prisma } from '@/lib/prisma'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

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
    title: `Apply to ${c.name} jobs — ${c.atsName} guide`,
    description: `How to apply to jobs at ${c.name}: their ${c.atsName} application form explained, live openings, and how to tailor your resume for it.`,
    alternates: { canonical: `${SITE}/apply-to/${c.slug}` },
  }
}

async function openRolesCount(matcher: string): Promise<number> {
  try {
    return await prisma.jobListing.count({ where: { url: { contains: matcher } } })
  } catch {
    return 0
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

  const guide = ATS_GUIDE[c.ats]
  const roles = await openRolesCount(jobUrlMatcher(c))
  const related = APPLY_COMPANIES.filter((x) => x.ats === c.ats && x.slug !== c.slug).slice(0, 6)

  const faq = [
    {
      q: `Which ATS does ${c.name} use for job applications?`,
      a: `${c.name} runs its hiring on ${c.atsName}. Applications submitted on the official board (${c.boardUrl}) go directly into their ${c.atsName} pipeline.`,
    },
    {
      q: `Should I tailor my resume for each ${c.name} role?`,
      a: `Yes. ${c.atsName} applications are reviewed against the specific posting, so mirroring the role's actual requirements (truthfully) is the highest-leverage 10 minutes you can spend.`,
    },
    {
      q: `Where do I find ${c.name}'s open roles?`,
      a: `The official board is ${c.boardUrl}. Aggregator re-posts often go stale — apply at the source.`,
    },
  ]

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
        · <Link href="/apply-to">All {APPLY_COMPANIES.length} companies</Link>
      </p>
    </article>
  )
}
