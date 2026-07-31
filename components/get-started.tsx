import Link from 'next/link'

/**
 * components/get-started.tsx — the first-run panel (P4.2).
 *
 * WHAT IT REPLACES: a new user's dashboard was a strip of five zeros and three
 * small cards each saying some version of "nothing here yet". That is a status
 * report on having achieved nothing, at the exact moment a person is deciding
 * whether this product is worth their time. It answers "what happened?" when the
 * only question they have is "what do I do?".
 *
 * This is the same screen rewritten as a path, with exactly one live CTA — the
 * step they are actually on. Done steps are ticked and stay visible, because
 * visible progress is the reason a checklist works at all.
 *
 * EVERY STEP IS OBSERVABLE. A checklist that cannot tell whether you finished a
 * step will either nag you forever or tick itself when you did nothing, and both
 * teach people to ignore it. So the three steps map to three rows in the
 * database — a resume, a campaign, an application — and the free fit check,
 * which is anonymous and therefore untrackable, sits underneath as a standing
 * offer rather than pretending to be a step.
 *
 * It disappears once the user has a resume and an application. From then on the
 * real dashboard has real numbers on it, and a permanent onboarding panel is
 * just clutter you have taught people to scroll past.
 *
 * HONESTY: every step describes what actually happens. No "get hired in 7 days",
 * no fake urgency, no counter of other people's applications. Step 3 says
 * outright that an application is only counted once the ATS confirms it —
 * setting that expectation before someone applies is the whole brand.
 *
 * Server component, zero client JS.
 */
interface Step {
  title: string
  body: string
  cta: string
  href: string
  done: boolean
}

export function GetStarted({
  resumes,
  applications,
  campaigns,
  extensionUrl,
}: {
  resumes: number
  applications: number
  campaigns: number
  /**
   * Chrome Web Store URL, or '' while the extension is unpublished. Empty means
   * step 2 offers a campaign instead — never a link to a listing that is not
   * there yet.
   */
  extensionUrl: string
}) {
  // Once there is a resume AND an application, the dashboard has something real
  // to show and this panel is in the way.
  if (resumes > 0 && applications > 0) return null

  const steps: Step[] = [
    {
      title: 'Add your resume',
      body:
        'Upload the PDF you already have and we read it into an editable profile — you check it, you do not retype it. About two minutes.',
      cta: 'Import my resume',
      href: '/dashboard/resumes/new',
      done: resumes > 0,
    },
    extensionUrl
      ? {
          title: 'Apply with one click',
          body:
            'The Chrome extension fills Greenhouse, Lever and Ashby forms from your profile, and tailors your resume for the posting you are looking at.',
          cta: 'Get the extension',
          href: extensionUrl,
          done: campaigns > 0 || applications > 0,
        }
      : {
          title: 'Set up a campaign',
          body:
            'Pick keywords and locations. We find matching jobs, tailor your resume for each one, and apply on your behalf.',
          cta: 'Create a campaign',
          href: '/dashboard/campaigns/new',
          done: campaigns > 0 || applications > 0,
        },
    {
      title: 'Watch what actually happens',
      body:
        'Applications land here with their real stage: queued, submitted, or confirmed. We only ever call one confirmed when the ATS says so — which is why the numbers on this dashboard are worth reading.',
      cta: 'See the public ledger',
      href: '/proof',
      done: applications > 0,
    },
  ]

  // Exactly one live CTA: the first thing that is not done.
  const currentIndex = steps.findIndex((s) => !s.done)

  return (
    <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">Get your first tailored application out</h2>
        <p className="mt-1 text-sm text-slate-500">
          Three steps, about ten minutes. You can stop after any of them.
        </p>
      </div>

      <ol className="space-y-3">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex
          return (
            <li
              key={step.title}
              className={`flex gap-4 rounded-xl border p-4 ${
                isCurrent
                  ? 'border-emerald-300 bg-emerald-50'
                  : step.done
                    ? 'border-slate-100 bg-slate-50'
                    : 'border-slate-100'
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  step.done || isCurrent ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                }`}
                aria-hidden
              >
                {step.done ? '✓' : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`font-semibold ${
                    step.done ? 'text-slate-400 line-through' : 'text-slate-900'
                  }`}
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
                )}
              </div>
              {isCurrent && (
                <Link
                  href={step.href}
                  className="my-auto shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  {step.cta} →
                </Link>
              )}
            </li>
          )
        })}
      </ol>

      {/* The fastest possible value, available at any point and free. Not a step
          because the fit check is anonymous — we cannot observe that you ran it,
          and a checklist item that never ticks is a checklist item people learn
          to ignore. */}
      <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500">
        In a hurry? Paste one job into the{' '}
        <Link href="/ats-check" className="font-medium text-emerald-600 hover:underline">
          free fit check
        </Link>{' '}
        — a score, the keywords that posting wants which your resume is missing, and what to
        change. Two minutes, no limit, nothing to set up.
      </p>
    </section>
  )
}
