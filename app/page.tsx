import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Navbar } from '@/components/navbar'
import { Check, Zap, Shield, TrendingUp } from 'lucide-react'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
                  Launch Your SaaS in Days, Not Months
                </h1>
                <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                  The complete Next.js starter kit with authentication, subscriptions, and payments
                  built-in. Focus on your product, not boilerplate.
                </p>
              </div>
              <div className="space-x-4">
                <Button asChild size="lg">
                  <Link href="/login">Get Started</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/pricing">View Pricing</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full bg-gray-50 py-12 md:py-24 lg:py-32 dark:bg-gray-900">
          <div className="container px-4 md:px-6">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
              Everything You Need to Launch
            </h2>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col items-center space-y-2 rounded-lg border p-6">
                <Zap className="h-12 w-12 text-primary" />
                <h3 className="text-xl font-bold">Lightning Fast</h3>
                <p className="text-center text-gray-500 dark:text-gray-400">
                  Built with Next.js 14 and optimized for performance
                </p>
              </div>
              <div className="flex flex-col items-center space-y-2 rounded-lg border p-6">
                <Shield className="h-12 w-12 text-primary" />
                <h3 className="text-xl font-bold">Secure by Default</h3>
                <p className="text-center text-gray-500 dark:text-gray-400">
                  NextAuth.js authentication with multiple providers
                </p>
              </div>
              <div className="flex flex-col items-center space-y-2 rounded-lg border p-6">
                <TrendingUp className="h-12 w-12 text-primary" />
                <h3 className="text-xl font-bold">Stripe Integration</h3>
                <p className="text-center text-gray-500 dark:text-gray-400">
                  Subscriptions and payments handled automatically
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
              Features
            </h2>
            <div className="mx-auto grid max-w-3xl gap-4">
              {[
                'Next.js 14 with App Router',
                'TypeScript for type safety',
                'Tailwind CSS for styling',
                'Prisma ORM with PostgreSQL',
                'NextAuth.js authentication',
                'Stripe subscriptions & payments',
                'Pre-built dashboard & settings',
                'Responsive design',
                'SEO optimized',
                'Production ready',
              ].map((feature) => (
                <div key={feature} className="flex items-center space-x-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            © 2024 Micro SaaS. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link href="/privacy" className="text-sm text-gray-500 hover:underline dark:text-gray-400">
              Privacy
            </Link>
            <Link href="/terms" className="text-sm text-gray-500 hover:underline dark:text-gray-400">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
