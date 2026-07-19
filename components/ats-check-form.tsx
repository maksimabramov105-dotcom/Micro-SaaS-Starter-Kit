'use client'

/**
 * AtsCheckForm — free fit check with gated full report (C1).
 * Phase 1: paste job + resume → score + 2 findings, rest locked.
 * Phase 2: email + explicit consent → full report on-page + emailed (t0 of
 * the nurture sequence). Unlock-beyond = the $4.99 tripwire.
 */
import { useState } from 'react'
import Link from 'next/link'

interface Result {
  score: number
  findings: string[]
  hints?: string[]
  locked?: { findings: number; hints: number }
  unlocked: boolean
  remaining: number
}

function scoreColor(s: number): string {
  if (s >= 75) return 'text-emerald-600'
  if (s >= 50) return 'text-amber-500'
  return 'text-rose-500'
}
function scoreLabel(s: number): string {
  if (s >= 75) return 'Strong match'
  if (s >= 50) return 'Partial match'
  return 'Weak match'
}

export function AtsCheckForm() {
  const [resumeText, setResumeText] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [emailed, setEmailed] = useState(false)

  async function submit(withEmail: boolean) {
    setError('')
    if (resumeText.trim().length < 40 || jobDescription.trim().length < 40) {
      setError('Please paste both your resume and the job description (a few sentences each).')
      return
    }
    if (withEmail && (!email.trim() || !consent)) {
      setError('Enter your email and tick the consent box to get the full report.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/ats-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText,
          jobDescription,
          jobTitle: jobTitle.trim() || undefined,
          ...(withEmail ? { email: email.trim(), consent } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong — please try again.')
        return
      }
      setResult(data as Result)
      if (withEmail) setEmailed(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
        className="grid gap-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Your resume (paste text)</span>
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={10}
              placeholder="Paste your resume text here…"
              className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
            />
          </label>
          <div className="grid gap-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Job title <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={200}
                placeholder="Senior Support Engineer"
                className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Job description</span>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={6}
                placeholder="Paste the full job posting here…"
                className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
              />
            </label>
          </div>
        </div>

        {error && !result && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {loading && !result ? 'Scoring…' : 'Check my fit — free, no sign-up'}
        </button>
        <p className="text-center text-xs text-slate-400">3 free checks per day · we never sell your data</p>
      </form>

      {result && (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-center">
            <div className={`text-6xl font-bold ${scoreColor(result.score)}`}>{result.score}</div>
            <div className="mt-1 text-sm font-medium text-slate-500">/ 100 · {scoreLabel(result.score)}</div>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">What the scorer found</h2>
          <ul className="mt-3 grid gap-2">
            {result.findings.map((f) => (
              <li key={f} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {f}
              </li>
            ))}
          </ul>

          {/* ── Locked tier → email capture (C1) ─────────────────────────── */}
          {!result.unlocked && (
            <div className="mt-4 rounded-xl border border-slate-200 p-5">
              <div aria-hidden className="select-none blur-sm">
                <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                  {'████ ██████ ███ █████'}
                </div>
                <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                  {'███ ████ ███████'}
                </div>
              </div>
              <p className="mt-3 text-center text-sm font-medium text-slate-700">
                {(result.locked?.findings ?? 0) > 0
                  ? `${result.locked?.findings} more finding${(result.locked?.findings ?? 0) === 1 ? '' : 's'} + `
                  : ''}
                your 3 personalized fixes are in the full report — free with your email.
              </p>
              <div className="mx-auto mt-4 grid max-w-md gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
                <label className="flex items-start gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Email me the full report and occasional job-search tips. Unsubscribe any time
                    with one click — see our{' '}
                    <Link href="/privacy" className="underline">
                      privacy policy
                    </Link>
                    .
                  </span>
                </label>
                {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => submit(true)}
                  className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {loading ? 'Unlocking…' : 'Unlock the full report — free'}
                </button>
              </div>
            </div>
          )}

          {/* ── Unlocked tier: fixes + tripwire ──────────────────────────── */}
          {result.unlocked && result.hints && (
            <>
              <h2 className="mt-8 text-lg font-semibold text-slate-900">Your 3 highest-leverage fixes</h2>
              <ol className="mt-3 grid gap-3">
                {result.hints.map((h, i) => (
                  <li key={h} className="flex gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                      {i + 1}
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ol>
              {emailed && (
                <p className="mt-4 text-center text-sm text-emerald-700">
                  📩 Full report sent — keep it as your baseline to beat.
                </p>
              )}
            </>
          )}

          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="font-semibold text-emerald-900">
              Want it fixed for you — for this exact job?
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              Resume Rescue rewrites your resume for the posting and includes the full keyword
              report. $4.99 one-time, delivered in minutes, auto-refund if we fail.
            </p>
            <Link
              href="/resume-rescue?ref=fitcheck"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Rescue my resume — $4.99
            </Link>
            <p className="mt-2 text-xs text-emerald-800">
              or{' '}
              <Link href="/login?ref=fitcheck" className="underline">
                start free — 3 applications/day
              </Link>
            </p>
          </div>

          <p className="mt-4 text-center text-xs text-slate-400">{result.remaining} free checks left today</p>
        </div>
      )}
    </div>
  )
}
