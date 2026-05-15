import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/react'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Micro SaaS Starter Kit',
  description: 'Production-ready boilerplate for launching subscription-based web tools',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'Micro SaaS Starter Kit',
    description: 'Production-ready boilerplate for launching subscription-based web tools',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Micro SaaS Starter Kit',
    description: 'Production-ready boilerplate for launching subscription-based web tools',
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
      </body>
    </html>
  )
}
