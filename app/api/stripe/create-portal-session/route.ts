import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripeBillingPortalSession } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { stripeCustomerId: true },
    })

    if (!user?.stripeCustomerId) {
      return new NextResponse('No Stripe customer found', { status: 400 })
    }

    const portalSession = await getStripeBillingPortalSession(user.stripeCustomerId)

    return NextResponse.json({ url: portalSession.url })
  } catch (error: any) {
    console.error('Error creating portal session:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
