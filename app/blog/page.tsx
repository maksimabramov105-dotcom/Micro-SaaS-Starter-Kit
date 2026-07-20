// app/blog/page.tsx — blog hub (B3). Posts are computed from our own
// pipeline telemetry, so the content is unique and self-updating.
import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata: Metadata = {
  title: 'Blog — honest data from real job applications',
  description:
    'What our verified application pipeline actually measures: how many applications reach a human, why auto-apply fails, and what that means for your search.',
  alternates: { canonical: `${SITE}/blog` },
  openGraph: {
    title: 'Blog — honest data from real job applications',
    description:
      'What our verified application pipeline measures: how many applications reach a human, and why auto-apply fails.',
    url: `${SITE}/blog`,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog — honest data from real job applications',
    description: 'How many applications reach a human, and why auto-apply fails. Live pipeline numbers.',
  },
}

const POSTS = [
  {
    slug: 'how-many-applications-reach-a-human',
    title: 'We verify every job application. Here is how many actually reach a human.',
    teaser:
      'Most tools count a click as "applied". We count ATS confirmations — and the gap between those two numbers explains a lot about modern job hunting.',
  },
  {
    slug: 'auto-apply-failure-modes',
    title: 'Auto-apply failure modes: what real ATS submissions taught us',
    teaser:
      'CAPTCHA walls, stale postings, surprise required fields: the honest breakdown of why automated applications fail, from our own production counters.',
  },
]

export default function BlogHub() {
  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <h1>Honest data from real job applications</h1>
      <p>
        We operate a verified application pipeline: nothing is marked &ldquo;applied&rdquo;
        unless the employer&apos;s ATS confirmed the submission. That produces telemetry most
        job-search tools do not have — and these posts are computed directly from it, updating
        as the numbers move.
      </p>
      <ul>
        {POSTS.map((p) => (
          <li key={p.slug} style={{ marginBottom: '1rem' }}>
            <Link href={`/blog/${p.slug}`} style={{ fontWeight: 600 }}>
              {p.title}
            </Link>
            <br />
            <span style={{ color: '#666', fontSize: 15 }}>{p.teaser}</span>
          </li>
        ))}
      </ul>
    </article>
      <SiteFooter />
    </>
  )
}
