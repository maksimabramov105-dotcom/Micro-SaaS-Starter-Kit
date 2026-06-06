'use client'

import { useState } from 'react'

interface Result {
  score: number
  missingKeywords: string[]
  fixes: string[]
}

function track(event: string, properties: Record<string, unknown> = {}) {
  // fire-and-forget; never blocks the UI
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, properties }),
  }).catch(() => {})
}

export function TeardownForm() {
  const [resumeText, setResumeText] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch('/api/teardown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, targetRole }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Please try again.')
      setResult(data as Result)
      setStatus('done')
      track('teardown_viewed_result', { score: (data as Result).score })
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (status === 'done' && result) {
    const color = result.score >= 70 ? '#059669' : result.score >= 45 ? '#d97706' : '#dc2626'
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 40, fontWeight: 700, color }}>{result.score}</span>
          <span style={{ color: '#64748b' }}>/ 100 ATS readiness</span>
        </div>
        {result.missingKeywords.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>Missing keywords</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.missingKeywords.map((k) => (
                <span key={k} style={{ fontSize: 13, background: '#f1f5f9', borderRadius: 999, padding: '2px 10px' }}>{k}</span>
              ))}
            </div>
          </>
        )}
        <h3 style={{ marginTop: 16 }}>3 fixes that get you more interviews</h3>
        <ol style={{ paddingLeft: 18 }}>
          {result.fixes.map((f) => <li key={f} style={{ marginBottom: 6 }}>{f}</li>)}
        </ol>
        <div style={{ marginTop: 20, padding: '1rem', borderRadius: 12, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <strong>Now apply at scale — eligibility-aware.</strong>
          <p style={{ fontSize: 14, color: '#475569', margin: '6px 0 12px' }}>
            ResumeAI-Bot tailors this resume to each role and only auto-applies to jobs you&apos;re
            actually eligible for. Start free — 3 applications/day.
          </p>
          <a
            href="/login?ref=teardown"
            onClick={() => track('teardown_signup_click', { score: result.score })}
            style={{ display: 'inline-block', background: '#059669', color: '#fff', fontWeight: 600, padding: '10px 20px', borderRadius: 8, textDecoration: 'none' }}
          >
            Start free →
          </a>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="text"
        value={targetRole}
        onChange={(e) => setTargetRole(e.target.value)}
        placeholder="Target role (e.g. Senior Backend Engineer)"
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 8 }}
      />
      <textarea
        value={resumeText}
        onChange={(e) => setResumeText(e.target.value)}
        placeholder="Paste your resume text here…"
        rows={8}
        required
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontFamily: 'inherit' }}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        style={{ marginTop: 8, background: '#059669', color: '#fff', fontWeight: 600, padding: '10px 20px', borderRadius: 8, border: 0, cursor: 'pointer', opacity: status === 'loading' ? 0.6 : 1 }}
      >
        {status === 'loading' ? 'Analyzing…' : 'Get my free teardown →'}
      </button>
      {error && <p style={{ color: '#dc2626', fontSize: 14, marginTop: 8 }}>{error}</p>}
      <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
        Instant, free, no signup. We don&apos;t store your resume.
      </p>
    </form>
  )
}
