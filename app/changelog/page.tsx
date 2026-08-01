import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SITE_URL } from '@/lib/site'

/**
 * app/changelog/page.tsx — what actually shipped, with dates.
 *
 * WHAT THIS REPLACES: the starter-kit template's changelog, still live and
 * publicly reachable, announcing "v1.0.0 — January 2024: Initial release with
 * full authentication system / API key management system / Responsive design
 * with Tailwind CSS". None of that is ResumeAI's history. The product did not
 * exist in January 2024 and those are not its features — it was invented
 * history on a public page, which is exactly the thing this product refuses to
 * do everywhere else. A visitor who read it learned only that the site is an
 * unedited template.
 *
 * Every entry below is a real dated milestone from the project log. If an entry
 * cannot be pointed at something that actually shipped, it does not belong here.
 */
export const metadata: Metadata = {
  title: 'Changelog — what shipped, and when',
  description:
    'A dated record of what actually changed in ResumeAI: verified applications, fit reports, the resume importer, and the public ledger behind them.',
  alternates: { canonical: `${SITE_URL}/changelog` },
}

interface Entry {
  date: string
  title: string
  items: string[]
}

const ENTRIES: Entry[] = [
  {
    date: '1 August 2026',
    title: 'Verified applications on the new domain',
    items: [
      'Inbound mail moved to resumeai-bot.com, so employer confirmation emails are matched back to your applications again.',
      'A hard ceiling on concurrent browser sessions in the apply worker, with a memory check on every path that launches one.',
    ],
  },
  {
    date: '31 July 2026',
    title: 'Weekly digest, resume import, and a first-run path',
    items: [
      'A weekly email with a fit tip drawn from your own applications — the factor most likely to be costing you replies.',
      'Import the resume you already have: upload the PDF or paste the text and the form fills itself in. Your wording is copied across, never rewritten.',
      'A guided first-run path on the dashboard, replacing the wall of zeros a new account used to open on.',
      'Rebuilt the per-role resume guides around keywords taken from real indexed postings.',
    ],
  },
  {
    date: '30 July 2026',
    title: 'Fit reports on every application',
    items: [
      'Each application now keeps a per-factor breakdown — skills, seniority, eligibility, language — and shows what the scorer actually saw.',
      'Tailor a resume for the job you are looking at, straight from the browser extension.',
      'Campaign applications are tailored per posting instead of reusing one base resume.',
    ],
  },
  {
    date: '20 July 2026',
    title: 'The public ledger',
    items: [
      'The proof page publishes the real submitted, confirmed and failed counts — including the failures.',
      'An application is only ever counted as submitted once the employer’s system confirms it.',
    ],
  },
  {
    date: '17 July 2026',
    title: 'Resume Rescue',
    items: [
      'A one-off rewrite of your resume for a single posting, with a report showing what was getting you filtered out.',
      'If generation fails, the payment is refunded automatically rather than waiting for you to ask.',
    ],
  },
]

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="container mx-auto max-w-3xl px-4 py-12">
          <h1 className="text-4xl font-bold text-slate-900">Changelog</h1>
          <p className="mt-3 text-lg text-slate-600">
            What actually shipped, with dates. Everything here is something you can go and use.
          </p>

          <div className="mt-10 space-y-10">
            {ENTRIES.map((e) => (
              <section key={e.date} className="border-l-2 border-emerald-200 pl-6">
                <p className="text-sm font-medium text-emerald-700">{e.date}</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{e.title}</h2>
                <ul className="mt-3 space-y-2">
                  {e.items.map((item) => (
                    <li key={item} className="flex gap-2 text-slate-700">
                      <span
                        aria-hidden
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300"
                      />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
            The numbers behind all of this are public on the{' '}
            <Link href="/proof" className="font-medium text-emerald-700 hover:underline">
              verified application ledger
            </Link>
            , failures included.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
