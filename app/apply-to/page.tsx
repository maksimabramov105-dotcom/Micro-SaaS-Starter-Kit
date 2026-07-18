// app/apply-to/page.tsx — hub for the per-company application guides (B2).
import type { Metadata } from 'next'
import Link from 'next/link'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import { APPLY_COMPANIES } from '@/lib/seo/apply-companies'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata: Metadata = {
  title: `Apply to jobs at ${APPLY_COMPANIES.length} tech companies — ATS guides`,
  description:
    'Per-company application guides: which ATS each company uses, what their form asks, live open roles, and how to tailor your resume for it.',
  alternates: { canonical: `${SITE}/apply-to` },
}

const ATS_ORDER = ['greenhouse', 'lever', 'ashby', 'recruitee', 'personio'] as const

export default function ApplyToHubPage() {
  return (
    <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <h1>How to apply to jobs at {APPLY_COMPANIES.length} tech companies</h1>
      <p>
        Every company below hires through a public applicant tracking system (ATS) that we
        operate against daily — Greenhouse, Lever, Ashby, Recruitee, or Personio. Each guide
        explains what that company&apos;s application form actually asks, how its resume
        parsing behaves, and how to tailor your resume for it. Open-role counts refresh
        automatically from our crawler.
      </p>

      {ATS_ORDER.map((ats) => {
        const group = APPLY_COMPANIES.filter((c) => c.ats === ats)
        if (group.length === 0) return null
        return (
          <section key={ats}>
            <h2>
              {group[0].atsName} ({group.length})
            </h2>
            <p style={{ fontSize: 15 }}>
              {group.map((c) => (
                <Link key={c.slug} href={`/apply-to/${c.slug}`} style={{ marginRight: 10 }}>
                  {c.name}
                </Link>
              ))}
            </p>
          </section>
        )
      })}

      <RescueCtaBlock refTag="seo-apply-hub" />
    </article>
  )
}
