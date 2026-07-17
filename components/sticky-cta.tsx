'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// Routes where a marketing CTA shouldn't appear (app / auth / internal).
const HIDE_PREFIXES = ['/dashboard', '/login', '/signin', '/admin', '/extension', '/api']

/**
 * Sticky bottom CTA for cold marketing traffic. Appears after the visitor
 * scrolls past the hero, is dismissible (localStorage), and is hidden on
 * app/auth routes. Mounted once in the root layout so it also covers the
 * programmatic SEO landing pages (which otherwise only have a text-link CTA).
 *
 * SSG-safe: starts hidden (renders null) and only shows after a client scroll,
 * so it never forces static pages into client rendering.
 */
export function StickyCta() {
  const pathname = usePathname() || '/'
  const [scrolledEnough, setScrolledEnough] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem('sticky_cta_dismissed') === '1')
    } catch {
      setDismissed(false)
    }
    const onScroll = () => setScrolledEnough(window.scrollY > 500)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const hideOnRoute = HIDE_PREFIXES.some((p) => pathname.startsWith(p))
  if (dismissed || !scrolledEnough || hideOnRoute) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-emerald-800 bg-emerald-700/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="text-sm">
          <span className="font-semibold">Found a job you want?</span> Get your resume rewritten
          for that exact posting + a fit report.{' '}
          <span className="hidden sm:inline">$4.99 one-time, delivered in minutes.</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/resume-rescue?ref=sticky-cta"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Fix my resume — $4.99
          </a>
          <a
            href="/login?ref=sticky-cta"
            className="hidden text-sm font-semibold text-white underline sm:inline"
          >
            Start free
          </a>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try {
                localStorage.setItem('sticky_cta_dismissed', '1')
              } catch {
                /* ignore */
              }
              setDismissed(true)
            }}
            className="px-1 text-white/80 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
