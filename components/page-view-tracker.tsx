'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * First-party pageview + traffic-source tracker.
 *
 * Fires a `page_view` event to /api/analytics/event (-> Prisma AnalyticsEvent)
 * on every route change, capturing the path, referrer, and ?ref / utm_* params.
 * This is what lets us see which channel (Reddit, Product Hunt, an SEO page,
 * etc.) actually drove a visit — the self-hosted VPS deployment doesn't report
 * to Vercel Analytics, so this is the working measurement layer.
 *
 * Deliberately uses usePathname + window.location (NOT useSearchParams) so it
 * never forces the statically-generated marketing pages into client rendering.
 */
export function PageViewTracker() {
  const pathname = usePathname()
  const lastSent = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || lastSent.current === pathname) return
    lastSent.current = pathname

    const properties: Record<string, string> = { path: pathname }
    try {
      const sp = new URLSearchParams(window.location.search)
      const ref = sp.get('ref')
      if (ref) properties.ref = ref.slice(0, 60)
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
        const v = sp.get(k)
        if (v) properties[k] = v.slice(0, 60)
      }
      if (document.referrer) properties.referrer = document.referrer.slice(0, 200)
    } catch {
      // ignore — path alone is still useful
    }

    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_view', properties }),
      keepalive: true,
    }).catch(() => {
      // fire-and-forget
    })
  }, [pathname])

  return null
}
