import Link from 'next/link'
import { Navbar } from '@/components/navbar'
import { getVerifiedStats } from '@/lib/stats/verified'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

// Render at runtime (the DB isn't available during the CI build, so static
// generation would cache empty numbers). The DB query itself is cached 1h via
// unstable_cache — so the first real request shows live data and it stays cheap.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Live proof — real applications & replies | ResumeAI',
  description:
    'Live, real numbers from ResumeAI: applications confirmed by employer ATS, recruiter replies, and time-to-first-reply. No fake reviews — our actual data.',
  alternates: { canonical: `${SITE}/proof` },
  openGraph: {
    title: 'Live proof — real applications & replies | ResumeAI',
    description: 'Real numbers, updated hourly: confirmed submissions, replies, and time-to-first-reply.',
    url: `${SITE}/proof`,
  },
}

// Stats come from lib/stats/verified.ts — the single source shared with the
// blog, so no two pages can ever show different verified numbers (E1).
const getProof = getVerifiedStats

function Stat({ value, label, sub, accent }: { value: string; label: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <div className={`text-4xl font-bold ${accent ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export default async function ProofPage() {
  let p: Awaited<ReturnType<typeof getProof>> | null = null
  try {
    p = await getProof()
  } catch {
    p = null
  }
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <div className="text-center">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              Live · updated hourly
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
              Real proof, not stock testimonials
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
              We don&apos;t publish fake reviews. These are our actual numbers, straight from the
              database. A job only counts as &ldquo;sent&rdquo; once our system completes the
              application, and &ldquo;confirmed&rdquo; once the employer&apos;s ATS acknowledges it.
            </p>
          </div>

          {p ? (
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Stat value={p.submitted.toLocaleString()} label="Applications sent" sub="our system completed them" accent />
              <Stat value={p.confirmed.toLocaleString()} label="Confirmed by employer ATS" sub="acknowledged receipt" />
              <Stat value={p.humanReplies.toLocaleString()} label="Human replies captured" sub="interview · question · rejection" />
              <Stat
                value={p.medianReplyDays != null ? `${p.medianReplyDays.toFixed(1)}d` : '—'}
                label="Median time to first reply"
                sub={p.medianReplyDays != null ? 'from sent to response' : 'building up'}
              />
            </div>
          ) : (
            <p className="mt-12 text-center text-slate-500">Numbers are warming up — check back shortly.</p>
          )}

          <div className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">Honest about what this is</p>
            <p className="mt-1 text-amber-800">
              We show replies and confirmations because they&apos;re verifiable. We don&apos;t promise
              interviews — recruiters decide that. What we promise is that you only apply where
              you&apos;re genuinely eligible, with a resume tailored per role, and that every reply
              lands in your inbox. That&apos;s why our money-back guarantee is 30 days, no questions.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/login" className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700 transition-colors">
              Start free — 3 applications/day
            </Link>
            <Link href="/pricing" className="rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:bg-white transition-colors">
              See pricing
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
