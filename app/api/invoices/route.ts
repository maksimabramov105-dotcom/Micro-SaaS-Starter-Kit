import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserInvoices, getInvoiceStats } from '@/lib/invoices'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const statsOnly = searchParams.get('stats') === 'true'

    if (statsOnly) {
      const stats = await getInvoiceStats(session.user.id)
      return NextResponse.json(stats)
    }

    const invoices = await getUserInvoices(session.user.id)
    return NextResponse.json(invoices)
  } catch (error) {
    console.error('Error fetching invoices:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    )
  }
}
