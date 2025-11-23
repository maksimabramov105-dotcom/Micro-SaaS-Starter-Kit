'use client'

import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export default function SettingsPage() {
  const { data: session } = useSession()
  const [isLoading, setIsLoading] = useState(false)

  const handleManageBilling = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!session?.user) {
    return null
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-gray-500">Manage your account settings and preferences</p>
      </div>

      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={session.user.image || ''} alt={session.user.name || ''} />
                <AvatarFallback className="text-2xl">
                  {session.user.name?.charAt(0) || session.user.email?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h3 className="text-xl font-semibold">{session.user.name}</h3>
                <p className="text-sm text-gray-500">{session.user.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Manage your subscription and billing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-2">
                  Access the Stripe Customer Portal to manage your subscription, update payment
                  methods, and view billing history.
                </p>
              </div>
              <Button onClick={handleManageBilling} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Manage Subscription'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Danger Zone</CardTitle>
            <CardDescription>Irreversible actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-2">
                  Cancel your subscription and delete your account. This action cannot be undone.
                </p>
              </div>
              <Button variant="destructive" disabled>
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
