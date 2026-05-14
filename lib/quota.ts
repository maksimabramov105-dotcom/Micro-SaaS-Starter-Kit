import { prisma } from './prisma'

export async function canSendApplication(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyApplicationLimit: true, stripePriceId: true },
  })
  if (!user) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const count = await prisma.jobApplication.count({
    where: {
      userId,
      appliedAt: { gte: today },
      status: { in: ['SUBMITTED', 'INTERVIEW', 'OFFER'] },
    },
  })

  return count < user.dailyApplicationLimit
}

export async function consumeQuota(userId: string, jobApplicationId: string): Promise<void> {
  await prisma.jobApplication.updateMany({
    where: { id: jobApplicationId, userId, appliedAt: null },
    data: { appliedAt: new Date() },
  })
}
