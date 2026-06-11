'use client'

import { useState } from 'react'
import Link from 'next/link'

type Result = { score: number; hints: string[]; remaining: number }

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
  const [jobDescription, setJobDescription] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [emailed, setEmailed] = useState(false)

  async function check(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)
    if (resumeText.trim().length < 40 || jobDescription.trim().length < 40) {
      setError('Please paste both your resume and the job description (a few sentences each).')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/ats-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobDescription, email: email.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong — please try again.')
        return
      }
      setResult(data as Result)
      setEmailed(Boolean(email.trim()))
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <form onSubmit={check} className="grid gap-5">
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
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Job description</span>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={10}
              placeholder="Paste the full job posting here…"
              className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Email <span className="font-normal text-slate-400">(optional — we’ll send your report so you can keep it)</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
          />
        </label>

        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {loading ? 'Scoring…' : 'Check my match — free'}
        </button>
        <p className="text-center text-xs text-slate-400">No sign-up needed · 3 free checks per day · we never sell your data</p>
      </form>

      {result && (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-center">
            <div className={`text-6xl font-bold ${scoreColor(result.score)}`}>{result.score}</div>
            <div className="mt-1 text-sm font-medium text-slate-500">/ 100 · {scoreLabel(result.score)}</div>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">3 fixes to improve your match</h2>
          <ol className="mt-3 grid gap-3">
            {result.hints.map((h, i) => (
              <li key={i} className="flex gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ol>

          {emailed && (
            <p className="mt-4 text-center text-sm text-emerald-700">📩 We’ve emailed you this report.</p>
          )}

          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="font-semibold text-emerald-900">Don’t fix it by hand — let ResumeAI do it.</p>
            <p className="mt-1 text-sm text-emerald-800">
              We tailor your resume to every role automatically and auto-apply only where you’re eligible.
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Start free — 3 applications/day
            </Link>
          </div>

          <p className="mt-4 text-center text-xs text-slate-400">{result.remaining} free checks left today</p>
        </div>
      )}
    </div>
  )
}
