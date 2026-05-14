import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { upvoteFeedback, removeUpvote } from '@/lib/feedback'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> }
) {
  try {
    const { feedbackId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const feedback = await upvoteFeedback(feedbackId, session.user.id)
    return NextResponse.json(feedback)
  } catch (error: any) {
    console.error('Error upvoting feedback:', error)

    if (error.message === 'Already voted') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to upvote feedback' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> }
) {
  try {
    const { feedbackId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const feedback = await removeUpvote(feedbackId, session.user.id)
    return NextResponse.json(feedback)
  } catch (error: any) {
    console.error('Error removing upvote:', error)

    if (error.message === 'Not voted yet') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to remove upvote' },
      { status: 500 }
    )
  }
}
