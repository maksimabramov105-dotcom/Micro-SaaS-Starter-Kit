/**
 * Customer Support Ticket System
 * - Create and manage support tickets
 * - Ticket messaging
 * - Priority and status management
 * - Assignment and categorization
 */

import { prisma } from './prisma'
import { createNotification } from './notifications'
import { sendEmail } from './email'

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

/**
 * Create support ticket
 */
export async function createSupportTicket(params: {
  userId: string
  subject: string
  description: string
  priority?: TicketPriority
  category?: string
}) {
  const { userId, subject, description, priority = 'medium', category } = params

  const ticket = await prisma.supportTicket.create({
    data: {
      userId,
      subject,
      description,
      priority,
      category,
      status: 'open',
    },
  })

  // Notify user
  await createNotification({
    userId,
    title: 'Support Ticket Created',
    message: `Your ticket "${subject}" has been created. We'll respond soon.`,
    type: 'success',
    actionUrl: `/dashboard/support/${ticket.id}`,
  })

  // TODO: Send email notification to support team

  return ticket
}

/**
 * Get user tickets
 */
export async function getUserTickets(userId: string) {
  return await prisma.supportTicket.findMany({
    where: { userId },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Get ticket by ID
 */
export async function getTicket(ticketId: string) {
  return await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })
}

/**
 * Add message to ticket
 */
export async function addTicketMessage(params: {
  ticketId: string
  userId: string
  message: string
  isStaff?: boolean
  attachments?: any
}) {
  const { ticketId, userId, message, isStaff = false, attachments } = params

  const ticketMessage = await prisma.supportMessage.create({
    data: {
      ticketId,
      userId,
      message,
      isStaff,
      attachments,
    },
  })

  // Update ticket's updatedAt
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      updatedAt: new Date(),
      status: isStaff ? 'waiting' : 'in_progress',
    },
  })

  // Notify user if message is from staff
  if (isStaff) {
    await createNotification({
      userId: ticket.userId,
      title: 'New Support Response',
      message: `You have a new response on ticket "${ticket.subject}"`,
      type: 'info',
      actionUrl: `/dashboard/support/${ticketId}`,
    })

    // Send email notification
    // TODO: Implement email notification
  }

  return ticketMessage
}

/**
 * Update ticket status
 */
export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus
) {
  const updates: any = { status }

  if (status === 'resolved' || status === 'closed') {
    updates.closedAt = new Date()
  }

  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: updates,
  })

  // Notify user
  await createNotification({
    userId: ticket.userId,
    title: 'Ticket Status Updated',
    message: `Your ticket "${ticket.subject}" is now ${status}`,
    type: 'info',
    actionUrl: `/dashboard/support/${ticketId}`,
  })

  return ticket
}

/**
 * Update ticket priority
 */
export async function updateTicketPriority(
  ticketId: string,
  priority: TicketPriority
) {
  return await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { priority },
  })
}

/**
 * Assign ticket to staff
 */
export async function assignTicket(ticketId: string, assignedTo: string) {
  return await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      assignedTo,
      status: 'in_progress',
    },
  })
}

/**
 * Get all tickets (admin)
 */
export async function getAllTickets(filters?: {
  status?: TicketStatus
  priority?: TicketPriority
  assignedTo?: string
  category?: string
}) {
  const where: any = {}

  if (filters?.status) where.status = filters.status
  if (filters?.priority) where.priority = filters.priority
  if (filters?.assignedTo) where.assignedTo = filters.assignedTo
  if (filters?.category) where.category = filters.category

  return await prisma.supportTicket.findMany({
    where,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
  })
}

/**
 * Get ticket stats
 */
export async function getTicketStats(userId?: string) {
  const where: any = userId ? { userId } : {}

  const [total, open, inProgress, resolved, closed] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.count({ where: { ...where, status: 'open' } }),
    prisma.supportTicket.count({ where: { ...where, status: 'in_progress' } }),
    prisma.supportTicket.count({ where: { ...where, status: 'resolved' } }),
    prisma.supportTicket.count({ where: { ...where, status: 'closed' } }),
  ])

  return {
    total,
    open,
    inProgress,
    resolved,
    closed,
    active: open + inProgress,
  }
}

/**
 * Get average response time (in hours)
 */
export async function getAverageResponseTime(): Promise<number> {
  const tickets = await prisma.supportTicket.findMany({
    include: {
      messages: {
        where: { isStaff: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  })

  const responseTimes: number[] = []

  for (const ticket of tickets) {
    if (ticket.messages.length > 0) {
      const responseTime =
        ticket.messages[0].createdAt.getTime() - ticket.createdAt.getTime()
      responseTimes.push(responseTime)
    }
  }

  if (responseTimes.length === 0) return 0

  const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
  return Math.round(avgMs / (1000 * 60 * 60)) // Convert to hours
}

/**
 * Close ticket
 */
export async function closeTicket(ticketId: string) {
  return await updateTicketStatus(ticketId, 'closed')
}

/**
 * Reopen ticket
 */
export async function reopenTicket(ticketId: string) {
  return await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: 'open',
      closedAt: null,
    },
  })
}
