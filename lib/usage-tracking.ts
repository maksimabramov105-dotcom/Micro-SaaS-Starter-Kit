import { prisma } from './prisma'
import { notifyUsageLimit } from './notifications'

export async function trackUsage({
  userId,
  teamId,
  feature,
  quantity = 1,
  metadata,
}: {
  userId: string
  teamId?: string
  feature: string
  quantity?: number
  metadata?: any
}) {
  // Record usage
  await prisma.usageRecord.create({
    data: {
      userId,
      teamId,
      feature,
      quantity,
      metadata,
    },
  })

  // Update user usage count
  await prisma.user.update({
    where: { id: userId },
    data: {
      usageCount: {
        increment: quantity,
      },
    },
  })

  // Check if user is approaching limit
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { usageCount: true, usageLimit: true },
  })

  if (user) {
    const usagePercentage = (user.usageCount / user.usageLimit) * 100

    // Notify at 80%, 90%, and 100%
    if (usagePercentage >= 80 && usagePercentage < 90) {
      await notifyUsageLimit(userId, feature, 80)
    } else if (usagePercentage >= 90 && usagePercentage < 100) {
      await notifyUsageLimit(userId, feature, 90)
    } else if (usagePercentage >= 100) {
      await notifyUsageLimit(userId, feature, 100)
    }
  }
}

export async function getUsageStats(userId: string, days: number = 30) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const records = await prisma.usageRecord.findMany({
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

  // Group by feature
  const byFeature = records.reduce((acc: any, record) => {
    if (!acc[record.feature]) {
      acc[record.feature] = 0
    }
    acc[record.feature] += record.quantity
    return acc
  }, {})

  // Group by day
  const byDay = records.reduce((acc: any, record) => {
    const day = record.createdAt.toISOString().split('T')[0]
    if (!acc[day]) {
      acc[day] = 0
    }
    acc[day] += record.quantity
    return acc
  }, {})

  return {
    total: records.reduce((sum, r) => sum + r.quantity, 0),
    byFeature,
    byDay,
    records: records.slice(0, 100), // Latest 100 records
  }
}

export async function checkUsageLimit(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { usageCount: true, usageLimit: true },
  })

  if (!user) return false
  return user.usageCount < user.usageLimit
}

export async function resetUsage(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { usageCount: 0 },
  })
}
