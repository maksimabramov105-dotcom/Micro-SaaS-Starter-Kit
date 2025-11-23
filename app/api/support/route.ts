import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  createSupportTicket,
  getUserTickets,
  getAllTickets,
} from '@/lib/support'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const isAdmin = session.user.role === 'admin'

    if (isAdmin) {
      // Admin can see all tickets with filters
      const status = searchParams.get('status') as any
      const priority = searchParams.get('priority') as any

      const tickets = await getAllTickets({
        status,
        priority,
      })

      return NextResponse.json(tickets)
    } else {
      // Users see only their tickets
      const tickets = await getUserTickets(session.user.id)
      return NextResponse.json(tickets)
    }
  } catch (error) {
    console.error('Error fetching tickets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { subject, description, priority, category } = body

    if (!subject || !description) {
      return NextResponse.json(
        { error: 'Subject and description are required' },
        { status: 400 }
      )
    }

    const ticket = await createSupportTicket({
      userId: session.user.id,
      subject,
      description,
      priority,
      category,
    })

    return NextResponse.json(ticket, { status: 201 })
  } catch (error) {
    console.error('Error creating ticket:', error)
    return NextResponse.json(
      { error: 'Failed to create ticket' },
      { status: 500 }
    )
  }
}
