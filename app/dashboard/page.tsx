import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getUserPlan, isSubscriptionActive } from '@/lib/subscription'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return null
  }

  const plan = getUserPlan(session.user.stripePriceId || null)
  const isActive = isSubscriptionActive(session.user.stripeCurrentPeriodEnd || null)

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-500">Welcome back, {session.user.name}!</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your subscription details</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-2xl font-bold">{plan.name}</div>
              <div className="text-sm text-gray-500">
                {plan.price.monthly > 0
                  ? `$${plan.price.monthly}/month`
                  : 'Free forever'}
              </div>
              {isActive && session.user.stripeCurrentPeriodEnd && (
                <div className="text-sm text-gray-500">
                  Renews on {formatDate(session.user.stripeCurrentPeriodEnd)}
                </div>
              )}
              <div className="pt-4">
                {plan.slug === 'free' ? (
                  <Button asChild className="w-full">
                    <Link href="/pricing">Upgrade Plan</Link>
                  </Button>
                ) : (
                  <ManageBillingButton />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Your current usage stats</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Projects</span>
                <span className="text-sm font-medium">
                  0 / {plan.limits.projects === -1 ? '∞' : plan.limits.projects}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Storage</span>
                <span className="text-sm font-medium">
                  0 GB / {plan.limits.storage === -1 ? '∞' : `${plan.limits.storage / 1024} GB`}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Get started with your account</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href="/dashboard/settings">Account Settings</Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href="/pricing">View All Plans</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ManageBillingButton() {
  return (
    <form action={async () => {
      'use server'
      const session = await getServerSession(authOptions)
      if (!session?.user) return

      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/create-portal-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const data = await response.json()
      if (data.url) {
        redirect(data.url)
      }
    }}>
      <ManageBillingButtonClient />
    </form>
  )
}

function ManageBillingButtonClient() {
  return (
    <Button type="submit" className="w-full">
      Manage Billing
    </Button>
  )
}
