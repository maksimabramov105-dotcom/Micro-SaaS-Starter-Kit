import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

export const metadata = {
  title: 'Contact — ResumeAI',
  description: 'How to reach the ResumeAI team for support, privacy, and data requests.',
}

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <h1 className="mb-8 text-4xl font-bold">Contact</h1>

          <div className="prose prose-gray max-w-none">
            <p className="text-lg text-gray-600">
              ResumeAI is an automated job-application service operated online. We do not run a
              phone line — the fastest way to reach a human is email, and we reply within 1–2
              business days.
            </p>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">Support</h2>
              <p>
                Questions about your account, billing, or applications:{' '}
                <a href="mailto:support@resumeai-bot.ru" className="underline">
                  support@resumeai-bot.ru
                </a>
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">Privacy & data requests</h2>
              <p>
                To access, export, or delete your personal data (resumes, application history,
                stored recruiter replies), email{' '}
                <a href="mailto:support@resumeai-bot.ru" className="underline">
                  support@resumeai-bot.ru
                </a>{' '}
                or use the in-app account deletion. See our{' '}
                <a href="/privacy" className="underline">
                  Privacy Policy
                </a>{' '}
                for the full data-deletion (GDPR/CCPA) process.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">Billing</h2>
              <p>
                Payments are processed by Stripe. Refunds under the 30-day money-back guarantee can
                be requested in-app from{' '}
                <a href="/dashboard/billing" className="underline">
                  Billing
                </a>
                , or see the{' '}
                <a href="/refund-policy" className="underline">
                  Refund Policy
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
