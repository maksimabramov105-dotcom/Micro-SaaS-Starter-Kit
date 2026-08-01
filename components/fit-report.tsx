/**
 * components/fit-report.tsx — "why you're getting rejected" (P3.2).
 *
 * The paid feature that has visible value at ZERO interviews. A user who has
 * sent 40 applications and heard nothing has no idea whether the problem is the
 * resume, the seniority band, or work authorisation. This answers that from
 * data we already computed at apply time (ai/jobfit.py), so it costs no extra
 * LLM spend.
 *
 * Honesty rules, because this is the product's whole pitch:
 *  - never invent a number. If no score was recorded, say so plainly.
 *  - the breakdown is only rendered when it was actually persisted; older rows
 *    scored before the fitBreakdown column existed show reasons only.
 *  - the reasons come verbatim from the scorer. No spin.
 *
 * Server component, zero client JS.
 */

/** Max points each factor can contribute, mirroring ai/jobfit.py. */
const FACTOR_MAX: Record<string, number> = {
  skills: 50,
  seniority: 20,
  eligibility: 20,
  language: 10,
}

const FACTOR_LABEL: Record<string, string> = {
  skills: 'Skills overlap',
  seniority: 'Seniority match',
  eligibility: 'Work eligibility',
  language: 'Language',
}

/** What the user should actually DO when a factor scores low. */
const FACTOR_ADVICE: Record<string, string> = {
  skills:
    'Mirror the posting’s exact wording for tools you genuinely use. Most filters match on presence, not synonyms.',
  seniority:
    'Your title band is reading above or below the posting. Applying to the right level beats applying to more roles.',
  eligibility:
    'A knockout question (work authorisation, location) is filtering this out before a human sees it.',
  language:
    'The posting asks for a language your profile doesn’t list. Add it if you have it — truthfully.',
}

function scoreTone(pct: number): string {
  if (pct >= 0.75) return 'bg-emerald-500'
  if (pct >= 0.5) return 'bg-amber-500'
  return 'bg-rose-500'
}

export function FitReport({
  score,
  reasons,
  breakdown,
}: {
  score: number | null
  reasons: string[]
  breakdown?: Record<string, number> | null
}) {
  if (score === null) {
    return (
      <div className="rounded-lg border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-900">Fit report</h2>
        <p className="mt-1 text-sm text-slate-600">
          This application was recorded before fit scoring ran, so there’s no score for it.
          New applications include a full breakdown.
        </p>
      </div>
    )
  }

  const factors = breakdown
    ? Object.entries(breakdown).filter(([k]) => k in FACTOR_MAX)
    : []
  const weakest = factors
    .slice()
    .sort((a, b) => a[1] / FACTOR_MAX[a[0]] - b[1] / FACTOR_MAX[b[0]])[0]

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Fit report</h2>
        <span className="text-2xl font-bold text-slate-900">
          {score}
          <span className="text-base font-normal text-slate-500">/100</span>
        </span>
      </div>

      {factors.length > 0 && (
        <div className="mt-4 space-y-3">
          {factors.map(([key, value]) => {
            const max = FACTOR_MAX[key]
            const pct = Math.max(0, Math.min(1, value / max))
            return (
              <div key={key}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-700">{FACTOR_LABEL[key] ?? key}</span>
                  <span className="tabular-nums text-slate-500">
                    {value}/{max}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${scoreTone(pct)}`}
                    style={{ width: `${Math.round(pct * 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reasons.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-900">What the scorer saw</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="text-slate-400">
                  •
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {weakest && weakest[1] / FACTOR_MAX[weakest[0]] < 0.75 && (
        <div className="mt-5 rounded-md bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">
            Biggest lever: {FACTOR_LABEL[weakest[0]] ?? weakest[0]}
          </p>
          <p className="mt-1 text-sm text-slate-700">{FACTOR_ADVICE[weakest[0]]}</p>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Scored against this posting when the application was created. We never claim an
        application was submitted without an ATS confirmation — see your ledger on{' '}
        <a href="/proof" className="underline">
          /proof
        </a>
        .
      </p>
    </div>
  )
}
