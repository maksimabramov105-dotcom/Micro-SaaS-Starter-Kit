import { Navbar } from '@/components/navbar'
import { PricingCards } from '@/components/pricing-cards'

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="mb-12 text-center">
              <h1 className="mb-4 text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl">
                Simple, Transparent Pricing
              </h1>
              <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                Choose the plan that works best for you. All plans include a 14-day free trial.
              </p>
            </div>
            <PricingCards />
          </div>
        </section>
      </main>
    </div>
  )
}
