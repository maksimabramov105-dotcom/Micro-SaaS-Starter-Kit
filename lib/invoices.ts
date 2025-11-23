/**
 * Invoice Management System
 * - Create and manage invoices
 * - Stripe invoice integration
 * - Tax calculations
 * - Payment tracking
 */

import { prisma } from './prisma'
import { stripe } from './stripe'

/**
 * Generate unique invoice number
 */
export function generateInvoiceNumber(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')
  return `INV-${year}${month}-${random}`
}

/**
 * Create invoice
 */
export async function createInvoice(params: {
  userId: string
  teamId?: string
  items: Array<{
    description: string
    quantity: number
    unitPrice: number
  }>
  currency?: string
  taxRate?: number
  dueDate?: Date
}) {
  const { userId, teamId, items, currency = 'usd', taxRate = 0, dueDate } = params

  // Calculate amounts
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = Math.round(subtotal * taxRate)
  const amount = subtotal + tax

  const invoiceNumber = generateInvoiceNumber()

  return await prisma.invoice.create({
    data: {
      userId,
      teamId,
      invoiceNumber,
      status: 'draft',
      amount,
      currency,
      tax,
      items: items as any,
      dueDate,
    },
  })
}

/**
 * Create invoice from Stripe
 */
export async function createInvoiceFromStripe(params: {
  userId: string
  teamId?: string
  stripeInvoiceId: string
}) {
  const { userId, teamId, stripeInvoiceId } = params

  // Fetch Stripe invoice
  const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId)

  const items = stripeInvoice.lines.data.map((line) => ({
    description: line.description || '',
    quantity: line.quantity || 1,
    unitPrice: line.amount || 0,
  }))

  const invoiceNumber = generateInvoiceNumber()

  return await prisma.invoice.create({
    data: {
      userId,
      teamId,
      invoiceNumber,
      stripeInvoiceId,
      status: stripeInvoice.status || 'draft',
      amount: stripeInvoice.total,
      currency: stripeInvoice.currency,
      tax: stripeInvoice.tax || 0,
      items: items as any,
      paidAt: stripeInvoice.status_transitions.paid_at
        ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
        : null,
      dueDate: stripeInvoice.due_date
        ? new Date(stripeInvoice.due_date * 1000)
        : null,
      metadata: {
        stripeInvoiceNumber: stripeInvoice.number,
        stripeInvoiceUrl: stripeInvoice.hosted_invoice_url,
      },
    },
  })
}

/**
 * Get user invoices
 */
export async function getUserInvoices(userId: string) {
  return await prisma.invoice.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get team invoices
 */
export async function getTeamInvoices(teamId: string) {
  return await prisma.invoice.findMany({
    where: { teamId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get invoice by ID
 */
export async function getInvoice(invoiceId: string) {
  return await prisma.invoice.findUnique({
    where: { id: invoiceId },
  })
}

/**
 * Update invoice status
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
) {
  const updates: any = { status }

  if (status === 'paid') {
    updates.paidAt = new Date()
  }

  return await prisma.invoice.update({
    where: { id: invoiceId },
    data: updates,
  })
}

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(invoiceId: string) {
  return await updateInvoiceStatus(invoiceId, 'paid')
}

/**
 * Void invoice
 */
export async function voidInvoice(invoiceId: string) {
  return await updateInvoiceStatus(invoiceId, 'void')
}

/**
 * Get invoice stats
 */
export async function getInvoiceStats(userId: string) {
  const invoices = await getUserInvoices(userId)

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === 'paid').length,
    unpaid: invoices.filter((i) => i.status === 'open').length,
    overdue: invoices.filter(
      (i) => i.status === 'open' && i.dueDate && i.dueDate < new Date()
    ).length,
    totalAmount: invoices.reduce((sum, i) => sum + i.amount, 0),
    paidAmount: invoices
      .filter((i) => i.status === 'paid')
      .reduce((sum, i) => sum + i.amount, 0),
    unpaidAmount: invoices
      .filter((i) => i.status === 'open')
      .reduce((sum, i) => sum + i.amount, 0),
  }

  return stats
}

/**
 * Calculate tax
 */
export function calculateTax(amount: number, taxRate: number): number {
  return Math.round(amount * taxRate)
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

/**
 * Get overdue invoices
 */
export async function getOverdueInvoices(userId?: string) {
  const where: any = {
    status: 'open',
    dueDate: { lt: new Date() },
  }

  if (userId) {
    where.userId = userId
  }

  return await prisma.invoice.findMany({
    where,
    orderBy: { dueDate: 'asc' },
  })
}
