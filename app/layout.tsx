import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/react'

const inter = Inter({ subsets: ['latin'] })

const SITE_TITLE = 'ResumeAI-Bot — AI Resume Builder + Auto-Apply to Jobs in 50+ Countries'
const SITE_DESCRIPTION =
  'Build an ATS-ready resume with AI and auto-apply to jobs across 50+ countries. Free tier, 30-day money-back guarantee.'

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
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
