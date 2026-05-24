import { Navbar } from '@/components/navbar'

// Bump this date on any meaningful policy edit.
const LAST_UPDATED = new Date('2026-05-25')

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <h1 className="mb-8 text-4xl font-bold">Terms of Service</h1>

          <div className="prose prose-gray max-w-none">
            <p className="text-lg text-gray-600">
              Last updated:{' '}
              {LAST_UPDATED.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
              <p>
                By accessing and using this service, you accept and agree to be bound by the terms
                and provision of this agreement.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">2. Use License</h2>
              <p>
                Permission is granted to temporarily download one copy of the materials on our
                service for personal, non-commercial transitory viewing only.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">3. Disclaimer</h2>
              <p>
                The materials on our service are provided on an &apos;as is&apos; basis. We make no
                warranties, expressed or implied, and hereby disclaim and negate all other
                warranties including, without limitation, implied warranties or conditions of
                merchantability, fitness for a particular purpose, or non-infringement of
                intellectual property or other violation of rights.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">4. Limitations</h2>
              <p>
                In no event shall our company or its suppliers be liable for any damages (including,
                without limitation, damages for loss of data or profit, or due to business
                interruption) arising out of the use or inability to use our service.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">5. Revisions</h2>
              <p>
                We may revise these terms of service at any time without notice. By using this
                service you are agreeing to be bound by the then current version of these terms of
                service.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">6. Subscription and Billing</h2>
              <p>
                All subscriptions are billed automatically on a recurring basis. You can cancel your
                subscription at any time through your account settings or by contacting support.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">7. Referral Program</h2>
              <p>
                We operate a double-sided referral program. When you refer a new user who subscribes
                to a paid plan, both you and the referred user receive a $20 account credit applied
                to future invoices. Credits are non-transferable and have no cash value.
              </p>
              <p className="mt-3">
                Referral rewards are capped at 10 successful referrals per account ($200 total
                credit). We reserve the right to withhold or reverse credits in cases of suspected
                abuse, self-referral, or fraud. Credits are clawed back if the referred user
                requests a refund within 30 days of their first payment.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">8. Affiliate Program</h2>
              <p>
                We run an affiliate program via Tolt. Third-party content creators and affiliates
                may earn recurring commissions on paid subscriptions they refer. Affiliate
                commissions are paid by us and do not affect the price you pay as a subscriber.
              </p>
              <p className="mt-3">
                If you arrived via an affiliate link, a cookie may be set to attribute your
                subscription to the affiliate. This is solely for commission tracking purposes and
                does not affect your account, your data, or your subscription terms.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
