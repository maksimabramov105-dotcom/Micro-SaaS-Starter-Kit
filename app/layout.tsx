import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/react'
import { PageViewTracker } from '@/components/page-view-tracker'
import { StickyCta } from '@/components/sticky-cta'

const inter = Inter({ subsets: ['latin'] })

const SITE_TITLE = 'ResumeAI-Bot — AI Resume Builder + Auto-Apply'
const SITE_DESCRIPTION =
  'Build an ATS-ready resume with AI and auto-apply to remote-first roles at 160+ companies (AU/NZ/US/EU). Free tier, 30-day money-back guarantee.'

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://resumeai-bot.ru'),
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Analytics />
        {/* First-party pageview + traffic-source tracking (works on the
            self-hosted VPS, where Vercel Analytics above does not report). */}
        <PageViewTracker />
        {/* Sticky marketing CTA — appears after scroll, hidden on app/auth routes. */}
        <StickyCta />
        {/* Cloudflare Web Analytics — privacy-friendly pageviews/referrers.
            Only injected when NEXT_PUBLIC_CF_BEACON_TOKEN is set. (You can also
            enable it dashboard-side with zero code since the site is on CF.) */}
        {process.env.NEXT_PUBLIC_CF_BEACON_TOKEN && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={`{"token": "${process.env.NEXT_PUBLIC_CF_BEACON_TOKEN}"}`}
            strategy="afterInteractive"
          />
        )}
        {/* Tolt affiliate tracking — only injected when NEXT_PUBLIC_TOLT_REFERRAL_ID is set */}
        {process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID && (
          <Script
            src="https://files.tlt-cdn.com/tlt.js"
            data-tolt={process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  )
}
