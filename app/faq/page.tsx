import type { Metadata } from 'next'
import { Navbar } from '@/components/navbar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata: Metadata = {
  title: 'FAQ — ResumeAI-Bot',
  description:
    'Answers about AI resume building, auto-apply, pricing, security, refunds, and how applications are submitted on your behalf.',
  alternates: { canonical: `${SITE}/faq` },
}

const faqs = [
  {
    question: 'How do I get started?',
    answer:
      'Simply sign up with your Google or GitHub account, choose a plan that fits your needs, and start using the platform immediately.',
  },
  {
    question: 'Can I change my plan later?',
    answer:
      'Yes! You can upgrade or downgrade your plan at any time from your account settings. Changes will be prorated automatically.',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'We accept all major credit cards through Stripe, including Visa, Mastercard, American Express, and Discover.',
  },
  {
    question: 'Is there a free tier?',
    answer:
      'Yes! The Free plan lets you send up to 3 applications per day at no cost, with no credit card required. You can upgrade to Pro at any time for more applications and features.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer:
      'You can cancel your subscription at any time from your account settings. Click on "Manage Subscription" to access the billing portal.',
  },
  {
    question: 'What happens to my data if I cancel?',
    answer:
      'Your data will be retained for 30 days after cancellation. You can reactivate your account during this period to restore access.',
  },
  {
    question: 'Do you offer refunds?',
    answer:
      'We offer a 30-day money-back guarantee. If you\'re not satisfied with our service, contact us for a full refund.',
  },
  {
    question: 'How secure is my data?',
    answer:
      'We take security seriously. All data is encrypted in transit and at rest. We use industry-standard security practices and regularly audit our systems.',
  },
  {
    question: 'Do you store my job-site passwords?',
    answer:
      "No. ResumeAI-Bot never asks for or stores your job-site passwords. We apply on your behalf by completing the public application forms employers post (for example on Greenhouse), using your resume details and a dedicated ResumeAI email address — so there's no job-board login to share. The one optional exception is LinkedIn auto-apply, which requires your LinkedIn login: if you choose to enable it those credentials are encrypted, and if you skip it we still auto-apply everywhere else.",
  },
  {
    question: 'Will employers know I used a tool?',
    answer:
      'No. Your applications are submitted with your own tailored resume under your name and a dedicated email address — they look like applications you sent yourself.',
  },
  {
    question: 'Can I use the API?',
    answer:
      'API access is available on Pro and Unlimited plans. You can generate API keys from your dashboard settings to integrate with our platform programmatically.',
  },
  {
    question: 'Do you offer support?',
    answer:
      'Yes, we offer email support for all users. Pro plan subscribers receive priority support with faster response times.',
  },
]

export default function FaqPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Navbar />
      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold mb-4">Frequently Asked Questions</h1>
            <p className="text-lg text-gray-500">
              Find answers to common questions about our service
            </p>
          </div>

          <div className="grid gap-6">
            {faqs.map((faq, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-lg">{faq.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mt-12">
            <CardHeader>
              <CardTitle>Still have questions?</CardTitle>
              <CardDescription>
                Can&apos;t find the answer you&apos;re looking for? Contact our support team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Email us at{' '}
                <a href="mailto:support@resumeai-bot.ru" className="text-primary underline">
                  support@resumeai-bot.ru
                </a>{' '}
                and we&apos;ll get back to you as soon as possible.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
