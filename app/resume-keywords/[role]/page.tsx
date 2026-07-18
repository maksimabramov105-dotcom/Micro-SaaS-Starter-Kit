// app/resume-keywords/[role]/page.tsx — "Resume keywords for {role}" (B2).
// Keywords are extracted by our keyword engine from REAL job descriptions our
// crawler indexed (lib/seo/role-keywords.json, regenerated monthly) — pages
// exist only for roles with genuine corpus support, and new roles appear
// automatically as the listing corpus grows.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import roleData from '@/lib/seo/role-keywords.json'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

interface RoleKeywords {
  slug: string
  role: string
  keywords: string[]
  listingCount: number
  companies: string[]
}

const ROLES = roleData as RoleKeywords[]

export function generateStaticParams() {
  return ROLES.map((r) => ({ role: r.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ role: string }>
}): Promise<Metadata> {
  const { role } = await params
  const r = ROLES.find((x) => x.slug === role)
  if (!r) return {}
  return {
    title: `Resume keywords for ${r.role} roles (2026)`,
    description: `ATS keywords for ${r.role} resumes, extracted from ${r.listingCount} real job postings — plus how to use them honestly so you pass screening.`,
    alternates: { canonical: `${SITE}/resume-keywords/${r.slug}` },
  }
}

export default async function ResumeKeywordsPage({
  params,
}: {
  params: Promise<{ role: string }>
}) {
  const { role } = await params
  const r = ROLES.find((x) => x.slug === role)
  if (!r) notFound()

  const related = ROLES.filter((x) => x.slug !== r.slug).slice(0, 6)
  const faq = [
    {
      q: `Where do these ${r.role.toLowerCase()} keywords come from?`,
      a: `Our keyword engine extracted them from ${r.listingCount} real ${r.role.toLowerCase()} job descriptions indexed by our crawler (companies like ${r.companies.slice(0, 3).join(', ')}). They are what employers actually ask for, not a generic list.`,
    },
    {
      q: 'Should I add every keyword to my resume?',
      a: 'No. Add only the ones that are truthfully applicable to your experience. ATS screening checks presence, but the human who reads you next checks credibility — stuffing keywords you cannot defend loses interviews.',
    },
    {
      q: 'Where in the resume should keywords go?',
      a: 'The summary and your most recent role carry the most weight: recruiters scan the top third of page one first, and most ATS relevance scoring weighs recent experience heaviest.',
    },
  ]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Resume keywords', item: `${SITE}/resume-keywords` },
          { '@type': 'ListItem', position: 2, name: r.role, item: `${SITE}/resume-keywords/${r.slug}` },
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
        <Link href="/resume-keywords">Resume keywords</Link> › {r.role}
      </p>
      <h1>Resume keywords for {r.role} roles (2026)</h1>
      <p>
        These keywords were extracted by our keyword engine from{' '}
        <strong>{r.listingCount} real {r.role.toLowerCase()} job descriptions</strong> currently
        indexed by our crawler — postings from companies like {r.companies.slice(0, 4).join(', ')}.
        This is not a recycled listicle: it is what employers hiring for this role are asking
        for right now, and it refreshes as our crawler indexes new postings.
      </p>

      <h2>The keywords</h2>
      <p>
        {r.keywords.map((k) => (
          <span
            key={k}
            style={{
              display: 'inline-block',
              border: '1px solid #ddd',
              borderRadius: 999,
              padding: '0.2rem 0.7rem',
              margin: '0 0.4rem 0.5rem 0',
              fontSize: 14,
            }}
          >
            {k}
          </span>
        ))}
      </p>

      <h2>How to use them (without wrecking your credibility)</h2>
      <p>
        ATS screening is mostly presence-matching: the software checks whether the posting&apos;s
        key terms appear in your resume at all. That makes two mistakes common. The first is
        omission — you have the skill but call it something else, and the filter never sees it.
        Fix that by mirroring the employer&apos;s exact phrasing: if you write &ldquo;CI
        pipelines&rdquo; and the posting says &ldquo;continuous integration&rdquo;, use their
        words. The second mistake is stuffing — adding terms you cannot defend in an interview.
        That passes the software and fails the human, which is worse than failing early.
      </p>
      <p>
        Practically: put your strongest three keywords in the summary line, weave the rest into
        the bullets of your most recent two roles where they are truthfully applicable, and keep
        a skills section for the exact-match terms (tools, platforms, certifications). Then
        re-read the specific posting you are applying to — every job emphasizes a different
        subset, and tailoring to the actual posting beats any generic list, including this one.
      </p>

      <RescueCtaBlock context={`a ${r.role.toLowerCase()} posting`} refTag="seo-keywords" />

      <h2>Frequently asked questions</h2>
      {faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <hr style={{ margin: '2rem 0' }} />
      <p style={{ fontSize: 14 }}>
        More roles:{' '}
        {related.map((x) => (
          <Link key={x.slug} href={`/resume-keywords/${x.slug}`} style={{ marginRight: 8 }}>
            {x.role}
          </Link>
        ))}
        · <Link href="/resume-keywords">All roles</Link>
      </p>
    </article>
  )
}
