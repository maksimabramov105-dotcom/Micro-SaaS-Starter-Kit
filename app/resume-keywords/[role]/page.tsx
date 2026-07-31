// app/resume-keywords/[role]/page.tsx — "Resume keywords for {role}" (B2).
// Keywords are extracted by our keyword engine from REAL job descriptions our
// crawler indexed (lib/seo/role-keywords.json, regenerated monthly) — pages
// exist only for roles with genuine corpus support, and new roles appear
// automatically as the listing corpus grows.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import {
  ROLE_KEYWORDS as ROLES,
  getRole,
  roleMeta,
  roleIntro,
  roleFaq,
  ROLE_HOWTO_PARAGRAPHS,
} from '@/lib/seo/role-keywords'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.com'

export function generateStaticParams() {
  return ROLES.map((r) => ({ role: r.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ role: string }>
}): Promise<Metadata> {
  const { role } = await params
  const r = getRole(role)
  if (!r) return {}
  return {
    ...roleMeta(r),
    alternates: { canonical: `${SITE}/resume-keywords/${r.slug}` },
  }
}

export default async function ResumeKeywordsPage({
  params,
}: {
  params: Promise<{ role: string }>
}) {
  const { role } = await params
  const r = getRole(role)
  if (!r) notFound()

  const related = ROLES.filter((x) => x.slug !== r.slug).slice(0, 6)
  const faq = roleFaq(r)

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
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p style={{ fontSize: 14 }}>
        <Link href="/resume-keywords">Resume keywords</Link> › {r.role}
      </p>
      <h1>Resume keywords for {r.role} roles (2026)</h1>
      <p>{roleIntro(r)}</p>

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
      {ROLE_HOWTO_PARAGRAPHS.map((para) => (
        <p key={para.slice(0, 24)}>{para}</p>
      ))}

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
      <SiteFooter />
    </>
  )
}
