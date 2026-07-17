/**
 * /resume-rescue/result?order=<id> — post-payment delivery page (A2).
 * The client component polls the status endpoint; its first poll after
 * payment is what drives generation on the server.
 */
import { Navbar } from '@/components/navbar'
import { RescueResult } from '@/components/rescue-result'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'

export const metadata = {
  title: 'Your Resume Rescue — ResumeAI',
  description: 'Your tailored resume and fit report, generated for one specific job.',
  alternates: { canonical: `${SITE}/resume-rescue/result` },
  robots: { index: false },
}

export default async function RescueResultPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order } = await searchParams
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="w-full py-12">
          <div className="container mx-auto max-w-3xl px-4">
            {order ? (
              <RescueResult orderId={order} />
            ) : (
              <p className="text-center text-muted-foreground">
                Missing order reference — check the link in your email.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
