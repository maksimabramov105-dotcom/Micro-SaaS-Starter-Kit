import { prisma } from './prisma'

export async function logActivity({
  userId,
  action,
  metadata,
  ipAddress,
  userAgent,
}: {
  userId?: string
  action: string
  metadata?: any
  ipAddress?: string
  userAgent?: string
}) {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        metadata: metadata || {},
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    console.error('Failed to log activity:', error)
  }
}

export async function getUserAnalytics(userId: string, days: number = 30) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const activities = await prisma.activityLog.findMany({
    where: {
      userId,
      createdAt: {
        gte: startDate,
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  const activityByDay = activities.reduce((acc: any, activity) => {
    const day = activity.createdAt.toISOString().split('T')[0]
    acc[day] = (acc[day] || 0) + 1
    return acc
  }, {})

  return {
    totalActivities: activities.length,
    activityByDay,
    recentActivities: activities.slice(0, 10),
  }
}

export async function getAdminAnalytics() {
  const totalUsers = await prisma.user.count()
  const activeSubscriptions = await prisma.user.count({
    where: {
      stripeSubscriptionId: {
        not: null,
      },
      stripeCurrentPeriodEnd: {
        gte: new Date(),
      },
    },
  })

  const recentUsers = await prisma.user.findMany({
    take: 10,
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      stripePriceId: true,
    },
  })

  const usersByPlan = await prisma.user.groupBy({
    by: ['stripePriceId'],
    _count: true,
  })

  return {
    totalUsers,
    activeSubscriptions,
    recentUsers,
    usersByPlan,
  }
}
