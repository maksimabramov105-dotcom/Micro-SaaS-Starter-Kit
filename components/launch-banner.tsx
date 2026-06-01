'use client'

import { useEffect, useState } from 'react'

// Time-boxed launch offer. To end it early, set ACTIVE = false (or just let the
// Stripe promo code LAUNCH40 expire — checkout will reject it after that).
const ACTIVE = true
const CODE = 'LAUNCH40'
const ENDS_LABEL = 'June 8'

export function LaunchBanner() {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem('launch40_dismissed') === '1') setDismissed(true)
    } catch {
      /* ignore */
    }
  }, [])

  if (!ACTIVE || dismissed) return null

  return (
    <div className="relative bg-emerald-700 px-4 py-2 text-center text-sm text-white">
      🚀 <strong>Launch week</strong> — 40% off your first year. Use code{' '}
      <strong className="rounded bg-white/20 px-1.5 py-0.5 font-mono">{CODE}</strong>{' '}
      at checkout. Ends {ENDS_LABEL}.
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem('launch40_dismissed', '1')
          } catch {
            /* ignore */
          }
          setDismissed(true)
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  )
}
