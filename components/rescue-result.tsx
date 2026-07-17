'use client'

/**
 * RescueResult — polls /api/rescue/[id]/status and renders the delivery (A2).
 * The FIRST poll after payment is what triggers generation server-side, so
 * the fetch timeout must comfortably exceed the inline generation time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface FitReport {
  score?: number
  breakdown?: Record<string, number>
  reasons?: string[]
  keywords_present?: string[]
  keywords_missing?: string[]
  fixes?: string[]
}

interface StatusPayload {
  status: string
  jobTitle?: string
  jobCompany?: string
  fitReport?: FitReport | null
  resumeId?: string | null
  upsell?: { expiresAt: string } | null
}

const TEMPLATES = [
  'modern_minimalist',
  'classic_executive',
  'tech_compact',
  'creative_accent',
  'new_grad',
]

const BREAKDOWN_MAX: Record<string, number> = {
  skills: 50,
  seniority: 20,
  eligibility: 20,
  language: 10,
}

export function RescueResult({ orderId }: { orderId: string }) {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [template, setTemplate] = useState(TEMPLATES[0])
  const [pollError, setPollError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch(`/api/rescue/${orderId}/status`, { cache: 'no-store' })
      if (res.ok) {
        const payload: StatusPayload = await res.json()
        setData(payload)
        setPollError(false)
        if (['DELIVERED', 'FAILED', 'REFUNDED'].includes(payload.status)) return
      } else if (res.status === 404) {
        setData({ status: 'NOT_FOUND' })
        return
      }
    } catch {
      setPollError(true)
    } finally {
      inFlight.current = false
    }
    timer.current = setTimeout(poll, 4000)
  }, [orderId])

  useEffect(() => {
    poll()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  if (!data) {
    return <Centered>Loading your order…</Centered>
  }

  switch (data.status) {
    case 'NOT_FOUND':
      return <Centered>We could not find this order — check the link in your email.</Centered>

    case 'PENDING_PAYMENT':
      return (
        <Centered>
          Waiting for payment confirmation from Stripe…
          <SubNote>
            This usually takes a few seconds. If you cancelled checkout you can safely close
            this page.
          </SubNote>
        </Centered>
      )

    case 'PAID':
    case 'GENERATING':
      return (
        <Centered>
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="text-lg font-semibold">Rewriting your resume for this job…</div>
          <SubNote>
            Tailoring + fit analysis typically takes 1–3 minutes. This page updates by
            itself — and we email you the result either way, so you can close it.
            {pollError && ' (reconnecting…)'}
          </SubNote>
        </Centered>
      )

    case 'FAILED':
    case 'REFUNDED':
      return (
        <Centered>
          <div className="text-lg font-semibold">Generation failed on our side — sorry.</div>
          <SubNote>
            {data.status === 'REFUNDED'
              ? 'Your payment has been refunded in full automatically (5–10 business days depending on your bank). Details are in your email.'
              : 'Your refund is being processed and will be issued within 24 hours. Details are in your email.'}
          </SubNote>
        </Centered>
      )
  }

  // DELIVERED
  const report = data.fitReport ?? {}
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Your rescued resume is ready</h1>
        <p className="text-muted-foreground">
          Tailored for <b>{data.jobTitle}</b>
          {data.jobCompany ? (
            <>
              {' '}
              at <b>{data.jobCompany}</b>
            </>
          ) : null}
        </p>
      </div>

      {/* Download with template picker — all 5 unlocked for this resume */}
      <div className="rounded-lg border p-6">
        <h2 className="mb-3 text-lg font-semibold">Download your tailored resume</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t}
              onClick={() => setTemplate(t)}
              className={`rounded-full border px-3 py-1 text-sm ${
                template === t ? 'border-primary bg-primary text-primary-foreground' : ''
              }`}
            >
              {t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <a
          href={`/api/rescue/${orderId}/download?template=${template}`}
          className="inline-block rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90"
        >
          Download PDF
        </a>
        <p className="mt-3 text-xs text-muted-foreground">
          This resume also lives in your ResumeAI account — sign in with your purchase email
          (magic link, no password) to edit it any time.
        </p>
      </div>

      {/* Fit report */}
      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-lg font-semibold">
          Fit report{typeof report.score === 'number' ? ` — ${report.score}/100` : ''}
        </h2>

        {report.breakdown && (
          <div className="mb-5 space-y-2">
            {Object.entries(report.breakdown).map(([k, v]) => (
              <div key={k}>
                <div className="mb-0.5 flex justify-between text-sm">
                  <span className="capitalize">{k}</span>
                  <span>
                    {v}/{BREAKDOWN_MAX[k] ?? 100}
                  </span>
                </div>
                <div className="h-2 rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary"
                    style={{ width: `${Math.min(100, (v / (BREAKDOWN_MAX[k] ?? 100)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {report.keywords_missing && report.keywords_missing.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold">Keywords the job asks for that you were missing</h3>
            <div className="flex flex-wrap gap-1.5">
              {report.keywords_missing.map((k) => (
                <span key={k} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-900">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {report.keywords_present && report.keywords_present.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-semibold">Already covered</h3>
            <div className="flex flex-wrap gap-1.5">
              {report.keywords_present.map((k) => (
                <span key={k} className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-900">
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}

        {report.fixes && report.fixes.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Concrete fixes</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {report.fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Upsell */}
      {data.upsell && (
        <div className="rounded-lg border-2 border-primary p-6 text-center">
          <h2 className="mb-2 text-lg font-semibold">
            Applying to more than one job? Get this for every application.
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Pro tailors your resume for every job you apply to, runs 25 verified
            auto-applications a day, and collects recruiter replies in one inbox. Your first
            month is <b>$9</b> (then $19/mo) — this link works for 72 hours.
          </p>
          <a
            href={`/api/rescue/${orderId}/upsell`}
            className="inline-block rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90"
          >
            Get Pro — first month $9
          </a>
          <p className="mt-2 text-xs text-muted-foreground">
            30-day money-back guarantee, cancel anytime.
          </p>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="py-16 text-center">{children}</div>
}

function SubNote({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
}
