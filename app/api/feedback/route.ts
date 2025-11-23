import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  submitFeedback,
  getAllFeedback,
  getUserFeedback,
  getTopFeedback,
  getTrendingFeedback,
} from '@/lib/feedback'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter')
    const type = searchParams.get('type') as any
    const status = searchParams.get('status') as any

    let feedback

    switch (filter) {
      case 'top':
        feedback = await getTopFeedback(20, type)
        break
      case 'trending':
        feedback = await getTrendingFeedback(20)
        break
      case 'my':
        const session = await getServerSession(authOptions)
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        feedback = await getUserFeedback(session.user.id)
        break
      default:
        feedback = await getAllFeedback({ type, status })
    }

    return NextResponse.json(feedback)
  } catch (error) {
    console.error('Error fetching feedback:', error)
    return NextResponse.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const body = await request.json()
    const { type, title, description, category } = body

    if (!type || !title || !description) {
      return NextResponse.json(
        { error: 'Type, title, and description are required' },
        { status: 400 }
      )
    }

    const feedback = await submitFeedback({
      userId: session?.user?.id,
      type,
      title,
      description,
      category,
    })

    return NextResponse.json(feedback, { status: 201 })
  } catch (error) {
    console.error('Error submitting feedback:', error)
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    )
  }
}
