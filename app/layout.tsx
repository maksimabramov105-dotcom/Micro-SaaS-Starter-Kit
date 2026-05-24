import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/react'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ResumeAI',
  description: 'AI-generated resumes and automated job applications',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'ResumeAI',
    description: 'AI-generated resumes and automated job applications',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ResumeAI',
    description: 'AI-generated resumes and automated job applications',
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
