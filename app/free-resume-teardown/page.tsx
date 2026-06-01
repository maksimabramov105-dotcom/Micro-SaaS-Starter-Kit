// app/free-resume-teardown/page.tsx — lead-magnet landing (server component for
// SEO content; the email form is a small client component).
import type { Metadata } from 'next'
import Link from 'next/link'
import seo from '@/lib/seo-data.json'
import { LeadForm } from '@/components/lead-form'

const SITE = seo._meta.site

export const metadata: Metadata = {
  title: 'Free AI Resume Teardown — Get Expert Feedback in 24h | ResumeAI-Bot',
  description:
    'Get a free, AI-powered teardown of your resume: ATS score, missing keywords, and fixes to land more interviews. Then auto-apply to jobs in 50+ countries.',
  alternates: { canonical: `${SITE}/free-resume-teardown` },
  openGraph: {
    title: 'Free AI Resume Teardown — ResumeAI-Bot',
    description: 'A free, AI-powered teardown of your resume: ATS score, missing keywords, and concrete fixes.',
    url: `${SITE}/free-resume-teardown`,
    siteName: 'ResumeAI-Bot',
    type: 'article',
  },
  twitter: { card: 'summary_large_image' },
}

export default function FreeResumeTeardownPage() {
  return (
    <article style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <h1>Free AI Resume Teardown</h1>
      <p>
        Most resumes get rejected by an ATS before a human ever reads them. Send us your resume and
        our AI will give you a free teardown — your ATS score, the keywords you&apos;re missing for
        your target role, and the specific fixes that get you more interviews.
      </p>

      <div style={{ margin: '1.5rem 0', padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
        <strong>Enter your email to start — it&apos;s free.</strong>
        <LeadForm source="free-resume-teardown" />
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
          No spam. We use your email only to send your teardown. We never sell your data.
        </p>
      </div>

      <h2>What you get</h2>
      <ul>
        <li><strong>ATS readiness score</strong> — how likely your resume is to pass automated screens.</li>
        <li><strong>Missing keywords</strong> — the terms recruiters and ATS systems look for in your field.</li>
        <li><strong>Concrete rewrites</strong> — specific lines to change, not vague advice.</li>
      </ul>

      <h2>Then apply at scale</h2>
      <p>
        Once your resume is sharp, ResumeAI-Bot tailors it to each role and auto-applies to matching
        jobs across 50+ countries — so you get more interviews with far less effort.{' '}
        {seo._meta.freeTier}. Paid plans include a {seo._meta.guarantee}.
      </p>
      <p>
        <Link href="/?ref=seo-teardown" style={{ fontWeight: 600 }}>
          See how auto-apply works →
        </Link>
      </p>
    </article>
  )
}
