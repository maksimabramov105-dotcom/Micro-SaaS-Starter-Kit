import type { Metadata } from 'next'
import { Navbar } from '@/components/navbar'
import { AtsCheckForm } from '@/components/ats-check-form'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata: Metadata = {
  title: 'Free ATS Resume Checker — Score Your Match | ResumeAI',
  description:
    'Free ATS resume checker: paste your resume and a job description for an instant match score. Unlock the full report with 3 specific fixes — free.',
  alternates: { canonical: `${SITE}/ats-check` },
  openGraph: {
    title: 'Free ATS Resume Checker — Score Your Match | ResumeAI',
    description: 'Paste your resume + a job posting for an instant ATS match score. Full report with 3 specific fixes is free.',
    url: `${SITE}/ats-check`,
    siteName: 'ResumeAI-Bot',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'ResumeAI ATS Resume Checker',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: `${SITE}/ats-check`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  description:
    'Free ATS resume checker that scores how well your resume matches a job description and returns 3 specific improvement tips.',
}

export default function AtsCheckPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <div className="text-center">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Free · No sign-up
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
              Will your resume pass the ATS?
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
              Paste your resume and the job description for an instant match score — the same
              scoring engine our auto-apply system uses to target the right jobs. Unlock the full
              report with 3 specific fixes, free.
            </p>
          </div>

          <div className="mt-12">
            <AtsCheckForm />
          </div>

          <p className="mx-auto mt-12 max-w-2xl text-center text-xs text-slate-400">
            This is a keyword and skills-overlap match score to guide your edits — not a guarantee of an
            interview. Recruiters make the final call.
          </p>
        </div>
      </main>
    </div>
  )
}
