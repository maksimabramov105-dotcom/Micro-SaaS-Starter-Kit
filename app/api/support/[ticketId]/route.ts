import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getTicket,
  addTicketMessage,
  updateTicketStatus,
  updateTicketPriority,
} from '@/lib/support'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ticket = await getTicket(ticketId)

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Check permissions
    const isAdmin = session.user.role === 'admin'
    if (!isAdmin && ticket.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(ticket)
  } catch (error) {
    console.error('Error fetching ticket:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ticket' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { message } = body

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    const ticket = await getTicket(ticketId)
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const isAdmin = session.user.role === 'admin'
    if (!isAdmin && ticket.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const ticketMessage = await addTicketMessage({
      ticketId,
      userId: session.user.id,
      message,
      isStaff: isAdmin,
    })

    return NextResponse.json(ticketMessage, { status: 201 })
  } catch (error) {
    console.error('Error adding message:', error)
    return NextResponse.json(
      { error: 'Failed to add message' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { status, priority } = body

    const existing = await getTicket(ticketId)
    if (!existing) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // updateTicketStatus/Priority return the base ticket without relations;
    // merge with existing to preserve the messages relation for the response.
    let ticket: typeof existing = existing
    if (status) {
      ticket = { ...existing, ...(await updateTicketStatus(ticketId, status)) }
    }

    if (priority) {
      ticket = { ...existing, ...(await updateTicketPriority(ticketId, priority)) }
    }

    return NextResponse.json(ticket)
  } catch (error) {
    console.error('Error updating ticket:', error)
    return NextResponse.json(
      { error: 'Failed to update ticket' },
      { status: 500 }
    )
  }
}
