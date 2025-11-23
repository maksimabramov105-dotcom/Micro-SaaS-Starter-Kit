import { prisma } from './prisma'
import { nanoid } from 'nanoid'

export async function generateReferralCode(userId: string): Promise<string> {
  const code = nanoid(8).toUpperCase()

  await prisma.user.update({
    where: { id: userId },
    data: { referralCode: code },
  })

  return code
}

export async function getReferralCode(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  })

  return user?.referralCode || null
}

export async function createReferral(referralCode: string, referredEmail: string) {
  const referrer = await prisma.user.findUnique({
    where: { referralCode },
  })

  if (!referrer) {
    throw new Error('Invalid referral code')
  }

  const referral = await prisma.referral.create({
    data: {
      referrerId: referrer.id,
      referredEmail,
      status: 'pending',
    },
  })

  return referral
}

export async function completeReferral(
  referredEmail: string,
  referredId: string,
  reward: number = 100
) {
  const referral = await prisma.referral.findFirst({
    where: {
      referredEmail,
      status: 'pending',
    },
  })

  if (!referral) return null

  // Update referral status
  await prisma.referral.update({
    where: { id: referral.id },
    data: {
      referredId,
      status: 'completed',
      reward,
      completedAt: new Date(),
    },
  })

  // Award credits to referrer
  await prisma.user.update({
    where: { id: referral.referrerId },
    data: {
      credits: {
        increment: reward,
      },
    },
  })

  return referral
}

export async function getUserReferrals(userId: string) {
  return prisma.referral.findMany({
    where: { referrerId: userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getReferralStats(userId: string) {
  const referrals = await getUserReferrals(userId)

  const stats = {
    total: referrals.length,
    pending: referrals.filter((r) => r.status === 'pending').length,
    completed: referrals.filter((r) => r.status === 'completed').length,
    totalRewards: referrals.reduce((sum, r) => sum + r.reward, 0),
  }

  return stats
}
