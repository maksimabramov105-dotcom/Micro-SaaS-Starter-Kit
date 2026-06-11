'use client'

import { useEffect, useState } from 'react'
import { PROMO, isPromoActive, promoEndLabel } from '@/lib/promo'

export function LaunchBanner() {
  // Compute "active" on the client after mount so an expired promo never renders
  // (and to avoid an SSR/CSR time mismatch). Hidden until proven active.
  const [show, setShow] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem('launch40_dismissed') === '1'
    } catch {
      /* ignore */
    }
    setShow(isPromoActive(new Date()) && !dismissed)
  }, [])

  if (!show) return null

  return (
    <div className="relative bg-emerald-700 px-4 py-2 text-center text-sm text-white">
      🚀 <strong>Launch week</strong> — {PROMO.discountLabel}. Use code{' '}
      <strong className="rounded bg-white/20 px-1.5 py-0.5 font-mono">{PROMO.code}</strong>{' '}
      at checkout. Ends {promoEndLabel()}.
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem('launch40_dismissed', '1')
          } catch {
            /* ignore */
          }
          setShow(false)
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  )
}
