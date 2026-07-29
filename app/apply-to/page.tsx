// app/apply-to/page.tsx — hub for the per-company application guides (B2/G1).
// Server-rendered: the full company list ships in the HTML; the search/filter
// UI is a client island layered on top. Only companies with live open roles
// are shown, matching the sitemap and the per-company thin-page skip.
import type { Metadata } from 'next'
import Link from 'next/link'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import { ApplyToDirectory, type DirectoryCompany } from '@/components/apply-to-directory'
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'
import { getOpenRolesSnapshot, companyRoles } from '@/lib/seo/company-roles'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const revalidate = 21600 // 6h — keeps the directory + counts fresh

export const metadata: Metadata = {
  title: 'How to apply to jobs at top tech companies — ATS guides',
  description:
    'Per-company application guides: which ATS each company uses, what their form asks, live open roles, and how to tailor your resume for it.',
  alternates: { canonical: `${SITE}/apply-to` },
}

export default async function ApplyToHubPage() {
  const snap = await getOpenRolesSnapshot()

  // Every curated company is listed; those with live roles rise to the top via
  // the open-roles sort, so the directory leads with the companies actually
  // hiring right now without hiding the rest.
  const companies: DirectoryCompany[] = APPLY_COMPANIES.map((c) => ({
    slug: c.slug,
    name: c.name,
    ats: c.ats,
    atsName: c.atsName,
    openRoles: companyRoles(snap, c.slug)?.count ?? 0,
  })).sort((a, b) => b.openRoles - a.openRoles || a.name.localeCompare(b.name))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Apply-to guides', item: `${SITE}/apply-to` },
    ],
  }

  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <p style={{ fontSize: 14 }}>
          <Link href="/">Home</Link> › Apply-to guides
        </p>
        <h1>How to apply to jobs at top tech companies</h1>
        <p>
          Every company below hires through a public applicant tracking system (ATS) that we
          operate against daily — Greenhouse, Lever, Ashby, Recruitee, or Personio. Each guide
          explains what that company&apos;s application form actually asks, how its resume
          parsing behaves, and how to tailor your resume for it. Open-role counts refresh
          automatically from our crawler, and the companies hiring right now sort to the top.
        </p>

        <ApplyToDirectory companies={companies} />

        <RescueCtaBlock refTag="seo-apply-hub" />

        <p style={{ fontSize: 14 }}>
          Related: <Link href="/ats-check">free ATS fit check</Link> ·{' '}
          <Link href="/resume-keywords">resume keywords by role</Link> ·{' '}
          <Link href="/compare">how we compare</Link> ·{' '}
          <Link href="/alternatives/teal">Teal &amp; other alternatives</Link> ·{' '}
          <Link href="/blog">how many applications reach a human</Link>
        </p>
      </article>
      <SiteFooter />
    </>
  )
}
