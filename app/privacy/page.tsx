import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

// Bump this date on any meaningful policy edit.
const LAST_UPDATED = new Date('2026-05-25')

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <h1 className="mb-8 text-4xl font-bold">Privacy Policy</h1>

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
              <h2 className="text-2xl font-semibold mb-4">1. Information We Collect</h2>
              <p>
                We collect information you provide directly to us when you create an account,
                including your name, email address, and payment information through our payment
                processor Stripe. To operate the service we also store the <strong>resume content,
                contact details (phone, location, links), and screening answers</strong> you enter,
                your <strong>job-application history</strong>, and the <strong>recruiter and employer
                emails</strong> sent to your dedicated inbox address so we can show them to you and
                classify them (e.g. interview request, rejection).
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">2. How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>To provide, maintain, and improve our services</li>
                <li>To process transactions and send related information</li>
                <li>To send technical notices and support messages</li>
                <li>To respond to your comments and questions</li>
                <li>To monitor and analyze trends, usage, and activities</li>
              </ul>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">3. Information Sharing</h2>
              <p>
                We do not share your personal information with third parties except as described in
                this policy. We may share information with:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Service providers who perform services on our behalf (e.g., Stripe for payment processing)</li>
                <li>
                  <strong>Employers and their applicant-tracking systems</strong> (e.g. Greenhouse,
                  Lever, Workable): when you run an auto-apply campaign, we submit applications{' '}
                  <strong>on your behalf</strong> and transmit your resume, contact details, and
                  screening answers to the companies you apply to
                </li>
                <li>Law enforcement when required by law</li>
                <li>Other parties with your consent</li>
              </ul>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">3a. Automated Application Submission</h2>
              <p>
                ResumeAI submits job applications to third-party employers automatically on your
                behalf, using the resume and answers you provide. You authorize this when you create
                a campaign, you remain responsible for the accuracy of the information submitted, and
                we do not guarantee any interview or offer. You can pause or delete a campaign at any
                time to stop further submissions.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">4. Data Security</h2>
              <p>
                We take reasonable measures to help protect your personal information from loss,
                theft, misuse, unauthorized access, disclosure, alteration, and destruction.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">5. Your Rights</h2>
              <p>
                Under GDPR, the UK GDPR, and the CCPA you have the right to access, export, correct,
                or delete your personal information. You can delete your account and all associated
                data (resumes, application history, and stored recruiter emails) yourself from your
                account settings, or email{' '}
                <a href="mailto:support@resumeai-bot.ru" className="underline">
                  support@resumeai-bot.ru
                </a>{' '}
                and we will erase it within 30 days. Deleting your account immediately stops all
                automated application activity.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">6. Cookies</h2>
              <p>
                We use cookies and similar tracking technologies to track activity on our service
                and hold certain information. You can instruct your browser to refuse all cookies or
                to indicate when a cookie is being sent.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">7. Changes to This Policy</h2>
              <p>
                We may update this privacy policy from time to time. We will notify you of any
                changes by posting the new privacy policy on this page and updating the &quot;Last
                updated&quot; date.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">8. Contact Us</h2>
              <p>
                If you have any questions about this privacy policy, please contact us through your
                account settings or by email.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-semibold mb-4">9. AI-Powered Features</h2>
              <p>
                When you use AI-powered features (such as resume analysis, cover-letter generation,
                or job-match scoring), your resume content and related inputs are sent to
                OpenAI&apos;s API for processing via OpenRouter. We do not instruct OpenAI to store
                your data beyond the processing window, and your data is not used to train OpenAI
                models under our API agreement. LinkedIn credentials entered in the app are
                encrypted at rest and are only used to perform the automations you explicitly
                request.
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
