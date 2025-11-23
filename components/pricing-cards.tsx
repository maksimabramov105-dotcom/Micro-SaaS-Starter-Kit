'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Check } from 'lucide-react'
import { PLANS } from '@/lib/subscription'

export function PricingCards() {
  const { data: session } = useSession()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState<string | null>(null)

  const handleSubscribe = async (priceId: string | null, planName: string) => {
    if (!session) {
      router.push('/login')
      return
    }

    if (!priceId) {
      return
    }

    setIsLoading(planName)

    try {
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ priceId }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setIsLoading(null)
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <Card key={plan.slug} className={plan.slug === 'pro' ? 'border-primary shadow-lg' : ''}>
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardDescription>
              <span className="text-3xl font-bold">${plan.price.monthly}</span>
              {plan.price.monthly > 0 && <span className="text-muted-foreground">/month</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start">
                  <Check className="mr-2 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              variant={plan.slug === 'pro' ? 'default' : 'outline'}
              onClick={() => handleSubscribe(plan.priceId.monthly, plan.slug)}
              disabled={isLoading === plan.slug || plan.slug === 'free'}
            >
              {isLoading === plan.slug
                ? 'Loading...'
                : plan.slug === 'free'
                ? 'Current Plan'
                : 'Get Started'}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
