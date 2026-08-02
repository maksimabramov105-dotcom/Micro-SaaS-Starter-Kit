'use client'

/**
 * components/exit-intent.tsx — one last, honest offer on the way out (T3).
 *
 * Most people who run the free fit check read the score and leave. There is no
 * second chance to reach them: the check is anonymous by design, so if they go
 * without leaving an address we never learn the page worked.
 *
 * WHAT THIS DELIBERATELY IS NOT. Exit-intent is the most abused pattern on the
 * web, so the constraints are the feature:
 *
 *   - ONCE PER VISITOR, ever. Recorded in localStorage before the modal is even
 *     shown, so a refresh or a second tab cannot resurrect it.
 *   - Desktop only. On mobile there is no "moving toward the close button"
 *     signal, and the usual substitutes — scroll-up, timers, back-button traps —
 *     fire while someone is still reading. A modal that interrupts reading is
 *     just an interstitial.
 *   - No countdown, no fake scarcity, no "wait! are you sure?" guilt, no second
 *     ask. The close button is a real button, labelled, first in tab order.
 *   - It offers something true: the rest of the report they already generated.
 *
 * If it does not earn its place on those terms, it should be deleted rather
 * than loosened. Which requires being able to tell — hence exit_intent_shown
 * next to exit_intent_captured: a numerator with no denominator cannot answer
 * the question this modal has to keep answering.
 *
 * CAPTURE GOES THROUGH THE CALLER (onCapture), not straight to a lead endpoint.
 * As first shipped this posted to /api/lead, which writes { email, source } and
 * nothing else: no suppression check, no consent timestamp, no nurture
 * enrollment, and — the part that mattered — no email. The modal said "Sent —
 * check your inbox" and "The full breakdown is on its way" to someone who was
 * never going to receive anything. The owner of the report is the page that
 * generated it, so it hands the address back there and lets the real capture
 * path run.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const SEEN_KEY = 'rai_exit_intent_seen'

/** Fire-and-forget; a blocked or failed beacon must never affect the modal. */
function track(event: string, properties: Record<string, unknown>) {
  try {
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, properties, page: location.pathname }),
    }).catch(() => {})
  } catch {
    // non-critical
  }
}

export function ExitIntent({
  /** Where the capture came from, recorded on the Lead row. */
  source,
  /** Only arm once the visitor has something worth finishing. */
  enabled = true,
  /**
   * Performs the actual capture. Resolves true when the address was accepted
   * AND the promised email is on its way — the modal's success copy is only
   * honest if this is honest.
   */
  onCapture,
}: {
  source: string
  enabled?: boolean
  onCapture: (email: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const armed = useRef(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  const markSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Private mode: fall back to the in-memory guard below.
    }
  }

  useEffect(() => {
    if (!enabled || armed.current) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
    } catch {
      // If we cannot read the flag we cannot promise "once", so stay silent.
      return
    }
    // Pointer-based exit intent has no meaning on touch.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const onLeave = (e: MouseEvent) => {
      // Only the top edge — that is the direction of the tab bar and the close
      // button. Leaving sideways or downward is not an exit signal.
      if (e.clientY > 0 || e.relatedTarget) return
      armed.current = true
      markSeen()
      setOpen(true)
      // The denominator. Without it "3 captures" is a number with no meaning.
      track('exit_intent_shown', { source })
      document.removeEventListener('mouseout', onLeave)
    }

    document.addEventListener('mouseout', onLeave)
    return () => document.removeEventListener('mouseout', onLeave)
  }, [enabled, source])

  // Focus the close button when it opens: the way out should be the first thing
  // a keyboard or screen-reader user reaches.
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !consent) return
    setState('sending')
    try {
      // "done" is a promise that an email is coming, so it is only allowed when
      // the capture path says one is.
      const ok = await onCapture(email.trim())
      setState(ok ? 'done' : 'error')
      if (ok) track('exit_intent_captured', { source })
    } catch {
      setState('error')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-intent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="exit-intent-title" className="text-xl font-bold text-slate-900">
            {state === 'done' ? 'Sent — check your inbox' : 'Want the rest of the report?'}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close"
            className="shrink-0 rounded-lg px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {state === 'done' ? (
          <p className="mt-3 leading-relaxed text-slate-600">
            The full breakdown is on its way. If it does not arrive in a few minutes, check
            spam — and reply to it either way, it reaches a person.
          </p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed text-slate-600">
              You have already generated it. Leave an address and we will send the full
              keyword list and the fixes, free — no account needed.
            </p>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={state === 'sending' || !consent}
                className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {state === 'sending' ? 'Sending…' : 'Send it'}
              </button>
            </form>
            {/* The same explicit consent the on-page capture requires. The C4
                rule is server-enforced on /api/ats-check, so a growth surface
                cannot quietly hold itself to a lower standard than the form
                six inches above it. */}
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <span>Email me the full report. I can unsubscribe in one click.</span>
            </label>
            {state === 'error' && (
              <p className="mt-2 text-sm text-red-600">
                That did not go through. You can close this and carry on — nothing is lost.
              </p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              One email with your report. Unsubscribe in one click, any time.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
