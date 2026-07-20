// app/blog/[slug]/page.tsx — data-driven posts (B3). Stats sections render
// live pipeline telemetry under daily ISR: the numbers update themselves.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RescueCtaBlock } from '@/components/rescue-cta-block'
import { getVerificationStatsSafe, type VerificationStats } from '@/lib/blog/stats'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const revalidate = 86400 // daily — stats sections stay current

const POSTS = {
  'how-many-applications-reach-a-human': {
    title: 'We verify every application. How many reach a human?',
    description:
      'Live numbers from our verified pipeline: ATS-confirmed submissions, reply rates, and why a "1-click applied" counter tells you nothing.',
  },
  'auto-apply-failure-modes': {
    title: 'Auto-apply failure modes — from real ATS submissions',
    description:
      'The honest breakdown of why automated job applications fail: bot walls, stale postings, surprise fields — measured in production, updated daily.',
  },
} as const

type Slug = keyof typeof POSTS

export function generateStaticParams() {
  return Object.keys(POSTS).map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = POSTS[slug as Slug]
  if (!post) return {}
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `${SITE}/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `${SITE}/blog/${slug}`,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  }
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '0.4rem 1rem 0.4rem 0', color: '#555' }}>{label}</td>
      <td style={{ padding: '0.4rem 0', fontWeight: 700 }}>{value}</td>
    </tr>
  )
}

function ReachHumanPost({ s }: { s: VerificationStats }) {
  return (
    <>
      <h1>We verify every application. Here is how many actually reach a human.</h1>
      <p style={{ color: '#777', fontSize: 14 }}>
        Numbers computed live from our pipeline · updated {s.generatedAt}
      </p>
      <p>
        Every auto-apply tool shows you a counter of &ldquo;applications sent&rdquo;. Almost
        none of them can tell you what that number means, because they count the moment their
        software clicked a button — not the moment an employer&apos;s applicant tracking system
        accepted a submission. We built our pipeline the other way around: an application only
        counts when the ATS confirms it. That decision produces some uncomfortable, useful data.
      </p>
      <h2>The live numbers</h2>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <StatRow label="Applications our system completed" value={String(s.sent)} />
          <StatRow
            label="Confirmed received by the employer's ATS"
            value={`${s.confirmed}${s.confirmedPct !== null ? ` (${s.confirmedPct}%)` : ''}`}
          />
          <StatRow
            label="Replies captured in our inbox"
            value={`${s.replies} total, ${s.humanReplies} from humans`}
          />
          <StatRow
            label="Attempts that failed before submission"
            value={`${s.failed}${s.failedPct !== null ? ` (${s.failedPct}% of attempts)` : ''}`}
          />
        </tbody>
      </table>
      <h2>What the gap means</h2>
      <p>
        The distance between &ldquo;our software finished the form&rdquo; and &ldquo;the ATS
        acknowledged it&rdquo; is where spray-and-pray tools quietly lose their users&apos;
        applications: bot walls, expired postings, and validation errors that nobody re-checks.
        When a tool without verification tells you it applied to 500 jobs, some real fraction of
        those never existed as submissions at all — and you cannot know which.
      </p>
      <p>
        The second gap — between confirmed submissions and human replies — is the honest
        market-feedback number. It is why we built reply capture and fit reports instead of a
        bigger counter: the winning move is fewer, better-matched, verified applications, not
        more clicks.
      </p>
    </>
  )
}

function FailureModesPost({ s }: { s: VerificationStats }) {
  return (
    <>
      <h1>Auto-apply failure modes: what real ATS submissions taught us</h1>
      <p style={{ color: '#777', fontSize: 14 }}>
        Numbers computed live from our pipeline · updated {s.generatedAt}
      </p>
      <p>
        We automate job applications for a living, and a meaningful share of attempts fail
        before any human sees them — {s.failed} of our attempts so far
        {s.failedPct !== null ? ` (${s.failedPct}%)` : ''}. Instead of hiding that number, we
        bucket every failure and publish the distribution, because knowing HOW applications die
        changes how you should apply, with or without automation.
      </p>
      <h2>The failure distribution (live)</h2>
      {s.topFailureModes.length > 0 ? (
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {s.topFailureModes.map((f) => (
              <StatRow key={f.reason} label={f.reason} value={String(f.count)} />
            ))}
          </tbody>
        </table>
      ) : (
        <p>No failures recorded in the current window — check back as volume grows.</p>
      )}
      <h2>What each mode means for you</h2>
      <p>
        <strong>Stale postings</strong> are the silent killer: boards syndicate jobs that closed
        weeks ago, and an application to a dead posting feels identical to being rejected.
        Always apply at the company&apos;s own ATS board. <strong>Bot walls</strong> (CAPTCHAs,
        challenge pages) mostly protect the biggest brands — those are worth applying to by
        hand. <strong>Surprise required fields</strong> — salary expectations, visa questions,
        custom essays — are where careless automation submits garbage; we hard-stop instead of
        guessing, which is why our failed-attempt number is honest rather than zero.
      </p>
      <p>
        The takeaway is not &ldquo;automation is bad&rdquo; — it is that unverified automation
        is unaccountable. Whatever tool you use (including ours): demand to see which
        applications were confirmed, not clicked.
      </p>
    </>
  )
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = POSTS[slug as Slug]
  if (!post) notFound()

  const stats = await getVerificationStatsSafe()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    dateModified: stats?.generatedAt ?? new Date().toISOString().slice(0, 10),
    author: { '@type': 'Organization', name: 'ResumeAI' },
    mainEntityOfPage: `${SITE}/blog/${slug}`,
  }

  return (
    <>
      <SiteHeader />
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p style={{ fontSize: 14 }}>
        <Link href="/blog">Blog</Link>
      </p>
      {stats === null ? (
        <>
          <h1>{post.title}</h1>
          <p>
            The live numbers for this post are computed from our pipeline database, which is
            momentarily unavailable — check back shortly. The methodology: nothing is counted
            as &ldquo;applied&rdquo; unless the employer&apos;s ATS confirmed the submission,
            and every failure is bucketed and published rather than hidden.
          </p>
        </>
      ) : slug === 'how-many-applications-reach-a-human' ? (
        <ReachHumanPost s={stats} />
      ) : (
        <FailureModesPost s={stats} />
      )}
      <RescueCtaBlock refTag="blog-cta" />
      <p style={{ fontSize: 14 }}>
        See the numbers yourself: <Link href="/proof">the live verified ledger</Link>.
      </p>
    </article>
      <SiteFooter />
    </>
  )
}
