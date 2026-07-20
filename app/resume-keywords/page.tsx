// app/resume-keywords/page.tsx — hub for role keyword pages (B2).
import type { Metadata } from 'next'
import Link from 'next/link'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import roleData from '@/lib/seo/role-keywords.json'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

interface RoleKeywords {
  slug: string
  role: string
  keywords: string[]
  listingCount: number
}

const ROLES = roleData as RoleKeywords[]

export const metadata: Metadata = {
  title: 'Resume keywords by role — from real job postings',
  description:
    'ATS resume keywords per role, extracted from live job descriptions our crawler indexes — not recycled listicles. Refreshed as new postings arrive.',
  alternates: { canonical: `${SITE}/resume-keywords` },
}

export default function ResumeKeywordsHub() {
  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <h1>Resume keywords by role — extracted from real postings</h1>
      <p>
        Every page below lists the ATS keywords employers are actually asking for in that role,
        extracted by our keyword engine from live job descriptions our crawler indexes at real
        companies. Roles appear here only when we have genuine posting data for them — the list
        grows automatically as the crawler indexes more.
      </p>
      <ul>
        {ROLES.map((r) => (
          <li key={r.slug}>
            <Link href={`/resume-keywords/${r.slug}`}>Resume keywords for {r.role}</Link>{' '}
            <span style={{ color: '#777', fontSize: 14 }}>
              ({r.keywords.length} keywords from {r.listingCount} postings)
            </span>
          </li>
        ))}
      </ul>
      <RescueCtaBlock refTag="seo-keywords-hub" />
    </article>
      <SiteFooter />
    </>
  )
}
