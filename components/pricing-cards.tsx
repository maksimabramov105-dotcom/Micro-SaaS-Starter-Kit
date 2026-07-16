'use client'

import { useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Check, Lock } from 'lucide-react'
import { VISIBLE_PLANS, getMonthlyEquivalent, type BillingInterval } from '@/lib/pricing'

// ── Analytics helper (fire-and-forget; never throws) ─────────────────────────
async function trackClientEvent(event: string, properties: Record<string, unknown>) {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, properties }),
    })
  } catch {
    // non-critical — ignore
  }
}

// Savings copy per plan family ($19 x 12 = $228 vs $180 annual)
const SAVINGS = {
  pro: { amount: 48, label: 'Save $48/year' },
  unlimited: { amount: 60, label: 'Save $60/year' },
}

export function PricingCards() {
  const { data: session } = useSession()
  const router = useRouter()
  // Default to yearly so the first price shown is the better-value annual plan
  // (HOMEPAGE_COPY.md §6).
  const [interval, setInterval] = useState<BillingInterval>('year')
  const [isLoading, setIsLoading] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Plans visible in the current interval (always show Free)
  const visiblePlans = VISIBLE_PLANS.filter(
    (p) => p.intervalKey === null || p.intervalKey === interval,
  )

  const handleIntervalChange = useCallback(
    (next: BillingInterval) => {
      if (next === interval) return
      setInterval(next)
      trackClientEvent('pricing_interval_toggled', { from: interval, to: next })
    },
    [interval],
  )

  // Send plan slug + interval to server — never send raw price IDs from client.
  const handleSubscribe = async (planId: string) => {
    if (!session) {
      router.push('/login?callbackUrl=/pricing')
      return
    }

    // Map yearly plan IDs back to their family for the checkout endpoint
    const familyId = planId.replace('_yearly', '')

    // Tolt affiliate attribution: window.tolt_referral is set by files.tlt-cdn.com/tlt.js
    // when a visitor arrives via an affiliate link. Send it to the server so Stripe
    // checkout metadata includes tolt_referral for conversion attribution.
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
    const toltReferral: string | undefined =
      typeof w?.tolt_referral === 'string' ? (w.tolt_referral as string) : undefined

    setIsLoading(planId)
    setErrorMsg(null)

    try {
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: familyId, interval, ...(toltReferral ? { toltReferral } : {}) }),
      })

      if (!response.ok) {
        const text = await response.text()
        setErrorMsg(text || 'Something went wrong. Please try again.')
        return
      }

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        setErrorMsg('No checkout URL returned. Please try again.')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
    } finally {
      setIsLoading(null)
    }
  }

  return (
    <>
      {/* ── Billing interval toggle ─────────────────────────────────────── */}
      <div className="mb-10 flex justify-center">
        <div className="inline-flex items-center rounded-full border bg-muted p-1">
          <button
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              interval === 'month'
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => handleIntervalChange('month')}
          >
            Monthly
          </button>
          <button
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              interval === 'year'
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => handleIntervalChange('year')}
          >
            Yearly
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-200">
              Save 21%
            </span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mx-auto mb-6 max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {/* ── Plan cards (Free + Pro; Unlimited hidden until demand exists) ── */}
      <div className="mx-auto grid max-w-3xl gap-8 md:grid-cols-2">
        {visiblePlans.map((plan) => {
          const isFree = plan.id === 'free'
          const isPro = plan.id === 'pro' || plan.id === 'pro_yearly'
          const isYearly = plan.intervalKey === 'year'
          const family = plan.id.replace('_yearly', '') as 'pro' | 'unlimited'
          const savings = SAVINGS[family as keyof typeof SAVINGS]

          const monthlyEquiv = isYearly
            ? getMonthlyEquivalent(plan)
            : null

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                isPro
                  ? 'border-primary border-2 shadow-lg'
                  : isFree
                    ? 'border-slate-200 bg-slate-50/40 shadow-none' // de-emphasized so the eye lands on Pro
                    : 'shadow-sm'
              }`}
            >
              {/* Most Popular badge */}
              {isPro && (
                <div className="absolute -top-3.5 left-0 right-0 flex justify-center">
                  <Badge className="bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Most Popular
                  </Badge>
                </div>
              )}

              {/* Savings badge for yearly plans */}
              {isYearly && savings && (
                <div className="absolute -top-3.5 right-4">
                  <Badge
                    variant="outline"
                    className="border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200"
                  >
                    {savings.label}
                  </Badge>
                </div>
              )}

              <CardHeader className={isPro ? 'pt-6' : ''}>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>
                  {isFree ? (
                    <span className="text-3xl font-bold">Free</span>
                  ) : isYearly ? (
                    <div className="space-y-1">
                      <div>
                        <span className="text-3xl font-bold">${plan.price}</span>
                        <span className="text-muted-foreground">/year</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        That&apos;s just{' '}
                        <span className="font-medium text-foreground">
                          ${monthlyEquiv!.toFixed(2)}/month
                        </span>
                        , billed annually
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span className="text-3xl font-bold">${plan.price}</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  )}
                </CardDescription>
                {!isFree && (
                  <p className="mt-2 text-xs font-medium text-emerald-700">
                    ≈ ${(isYearly ? plan.price / 365 : plan.price / 30).toFixed(2)} per day — apply every day
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start">
                      <Check className="mr-2 h-5 w-5 shrink-0 text-primary" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  variant={isPro ? 'default' : 'outline'}
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={isLoading === plan.id || isFree}
                >
                  {isLoading === plan.id
                    ? 'Loading…'
                    : isFree
                    ? 'Current Plan'
                    : 'Get Started'}
                </Button>
                {!isFree && (
                  <div className="space-y-1 text-center text-xs text-muted-foreground">
                    <p>30-day money-back guarantee · cancel anytime</p>
                    <p className="flex items-center justify-center gap-1">
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      Secured by Stripe · no card details touch our servers
                    </p>
                  </div>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </>
  )
}
