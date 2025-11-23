import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
} from '@/lib/notifications'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const unreadOnly = searchParams.get('unreadOnly') === 'true'
    const countOnly = searchParams.get('countOnly') === 'true'

    if (countOnly) {
      const count = await getUnreadNotificationCount(session.user.id)
      return NextResponse.json({ count })
    }

    const notifications = await getUserNotifications(session.user.id, unreadOnly)

    return NextResponse.json({ notifications })
  } catch (error: any) {
    console.error('Error fetching notifications:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { notificationId, markAll } = await req.json()

    if (markAll) {
      await markAllNotificationsAsRead(session.user.id)
      return NextResponse.json({ success: true })
    }

    if (notificationId) {
      await markNotificationAsRead(notificationId, session.user.id)
      return NextResponse.json({ success: true })
    }

    return new NextResponse('Invalid request', { status: 400 })
  } catch (error: any) {
    console.error('Error updating notification:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
