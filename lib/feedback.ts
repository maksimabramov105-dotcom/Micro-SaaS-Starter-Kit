/**
 * Feedback and Feature Voting System
 * - User feedback collection
 * - Feature requests
 * - Bug reports
 * - Upvoting system
 * - Status tracking
 */

import { prisma } from './prisma'
import { createNotification } from './notifications'

export type FeedbackType = 'feature' | 'bug' | 'improvement' | 'question' | 'other'
export type FeedbackStatus =
  | 'under_review'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'declined'

/**
 * Submit feedback
 */
export async function submitFeedback(params: {
  userId?: string
  type: FeedbackType
  title: string
  description: string
  category?: string
  metadata?: any
}) {
  const { userId, type, title, description, category, metadata } = params

  return await prisma.feedback.create({
    data: {
      userId,
      type,
      title,
      description,
      category,
      status: 'under_review',
      metadata,
    },
  })
}

/**
 * Get all feedback
 */
export async function getAllFeedback(filters?: {
  type?: FeedbackType
  status?: FeedbackStatus
  category?: string
}) {
  const where: any = {}

  if (filters?.type) where.type = filters.type
  if (filters?.status) where.status = filters.status
  if (filters?.category) where.category = filters.category

  return await prisma.feedback.findMany({
    where,
    orderBy: [{ votes: 'desc' }, { createdAt: 'desc' }],
  })
}

/**
 * Get user's feedback
 */
export async function getUserFeedback(userId: string) {
  return await prisma.feedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Get feedback by ID
 */
export async function getFeedback(feedbackId: string) {
  return await prisma.feedback.findUnique({
    where: { id: feedbackId },
  })
}

/**
 * Upvote feedback
 */
export async function upvoteFeedback(feedbackId: string, userId: string) {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
  })

  if (!feedback) {
    throw new Error('Feedback not found')
  }

  // Check if user already voted
  const voters = feedback.voters || []
  if (voters.includes(userId)) {
    throw new Error('Already voted')
  }

  // Add vote
  return await prisma.feedback.update({
    where: { id: feedbackId },
    data: {
      votes: { increment: 1 },
      voters: [...voters, userId],
    },
  })
}

/**
 * Remove upvote
 */
export async function removeUpvote(feedbackId: string, userId: string) {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
  })

  if (!feedback) {
    throw new Error('Feedback not found')
  }

  const voters = feedback.voters || []
  if (!voters.includes(userId)) {
    throw new Error('Not voted yet')
  }

  // Remove vote
  return await prisma.feedback.update({
    where: { id: feedbackId },
    data: {
      votes: { decrement: 1 },
      voters: voters.filter((v) => v !== userId),
    },
  })
}

/**
 * Check if user voted
 */
export async function hasUserVoted(
  feedbackId: string,
  userId: string
): Promise<boolean> {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { voters: true },
  })

  return feedback?.voters?.includes(userId) || false
}

/**
 * Update feedback status
 */
export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
  adminNote?: string
) {
  const feedback = await prisma.feedback.update({
    where: { id: feedbackId },
    data: {
      status,
      metadata: adminNote
        ? {
            adminNote,
            statusUpdatedAt: new Date(),
          }
        : undefined,
    },
  })

  // Notify the user who submitted feedback
  if (feedback.userId) {
    await createNotification({
      userId: feedback.userId,
      title: 'Feedback Status Updated',
      message: `Your feedback "${feedback.title}" is now ${status}`,
      type: 'info',
      actionUrl: `/dashboard/feedback/${feedbackId}`,
    })
  }

  // Notify all voters if status is completed
  if (status === 'completed' && feedback.voters) {
    for (const voterId of feedback.voters) {
      await createNotification({
        userId: voterId,
        title: 'Feature Completed!',
        message: `A feature you voted for has been completed: "${feedback.title}"`,
        type: 'success',
        actionUrl: `/dashboard/feedback/${feedbackId}`,
      })
    }
  }

  return feedback
}

/**
 * Get top feedback (most voted)
 */
export async function getTopFeedback(limit = 10, type?: FeedbackType) {
  const where: any = {}
  if (type) where.type = type

  return await prisma.feedback.findMany({
    where,
    orderBy: { votes: 'desc' },
    take: limit,
  })
}

/**
 * Get recent feedback
 */
export async function getRecentFeedback(limit = 10) {
  return await prisma.feedback.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Get feedback stats
 */
export async function getFeedbackStats() {
  const [
    total,
    features,
    bugs,
    underReview,
    planned,
    inProgress,
    completed,
    declined,
  ] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({ where: { type: 'feature' } }),
    prisma.feedback.count({ where: { type: 'bug' } }),
    prisma.feedback.count({ where: { status: 'under_review' } }),
    prisma.feedback.count({ where: { status: 'planned' } }),
    prisma.feedback.count({ where: { status: 'in_progress' } }),
    prisma.feedback.count({ where: { status: 'completed' } }),
    prisma.feedback.count({ where: { status: 'declined' } }),
  ])

  const allFeedback = await prisma.feedback.findMany({
    select: { votes: true },
  })

  const totalVotes = allFeedback.reduce((sum, f) => sum + f.votes, 0)

  return {
    total,
    byType: {
      features,
      bugs,
      other: total - features - bugs,
    },
    byStatus: {
      underReview,
      planned,
      inProgress,
      completed,
      declined,
    },
    totalVotes,
    avgVotesPerFeedback: total > 0 ? totalVotes / total : 0,
  }
}

/**
 * Get trending feedback
 * Based on recent votes and creation date
 */
export async function getTrendingFeedback(limit = 10) {
  // Get feedback from last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const feedback = await prisma.feedback.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: { in: ['under_review', 'planned'] },
    },
  })

  // Calculate trend score (votes / age in days)
  const trending = feedback
    .map((f) => {
      const ageInDays =
        (Date.now() - f.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      const trendScore = f.votes / Math.max(ageInDays, 1)

      return {
        ...f,
        trendScore,
      }
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, limit)

  return trending
}

/**
 * Search feedback
 */
export async function searchFeedback(query: string, limit = 20) {
  return await prisma.feedback.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { votes: 'desc' },
    take: limit,
  })
}

/**
 * Get feedback roadmap (planned and in progress)
 */
export async function getFeedbackRoadmap() {
  const [planned, inProgress, completed] = await Promise.all([
    prisma.feedback.findMany({
      where: { status: 'planned', type: 'feature' },
      orderBy: { votes: 'desc' },
    }),
    prisma.feedback.findMany({
      where: { status: 'in_progress', type: 'feature' },
      orderBy: { votes: 'desc' },
    }),
    prisma.feedback.findMany({
      where: { status: 'completed', type: 'feature' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ])

  return {
    planned,
    inProgress,
    recentlyCompleted: completed,
  }
}

/**
 * Delete feedback (admin only)
 */
export async function deleteFeedback(feedbackId: string) {
  return await prisma.feedback.delete({
    where: { id: feedbackId },
  })
}
