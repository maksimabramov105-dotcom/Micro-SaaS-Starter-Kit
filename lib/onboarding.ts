/**
 * Onboarding Flow System
 * - Track user onboarding progress
 * - Step completion
 * - Personalized onboarding paths
 * - Progress analytics
 */

import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import { createNotification } from './notifications'

export type OnboardingStepType =
  | 'welcome'
  | 'profile_setup'
  | 'team_creation'
  | 'subscription'
  | 'api_key'
  | 'first_api_call'
  | 'invite_team'
  | 'custom'

export const DEFAULT_ONBOARDING_STEPS: OnboardingStepType[] = [
  'welcome',
  'profile_setup',
  'subscription',
  'api_key',
  'first_api_call',
]

/**
 * Initialize onboarding for user
 */
export async function initializeOnboarding(
  userId: string,
  steps: string[] = DEFAULT_ONBOARDING_STEPS
): Promise<void> {
  for (const step of steps) {
    await prisma.onboardingStep.upsert({
      where: {
        userId_step: { userId, step },
      },
      create: {
        userId,
        step,
        completed: false,
      },
      update: {},
    })
  }

  // Mark user as not onboarded
  await prisma.user.update({
    where: { id: userId },
    data: {
      onboarded: false,
      onboardingStep: 0,
    },
  })
}

/**
 * Complete onboarding step
 */
export async function completeOnboardingStep(
  userId: string,
  step: string,
  data?: any
): Promise<void> {
  await prisma.onboardingStep.upsert({
    where: {
      userId_step: { userId, step },
    },
    create: {
      userId,
      step,
      completed: true,
      completedAt: new Date(),
      data,
    },
    update: {
      completed: true,
      completedAt: new Date(),
      data,
    },
  })

  // Check if all steps completed
  const allSteps = await prisma.onboardingStep.findMany({
    where: { userId },
  })

  const allCompleted = allSteps.every((s) => s.completed)

  if (allCompleted) {
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    })

    // Congratulate user
    await createNotification({
      userId,
      title: '🎉 Onboarding Complete!',
      message: "You're all set up! Let's get started.",
      type: 'success',
    })
  }
}

/**
 * Get user's onboarding progress
 */
export async function getOnboardingProgress(userId: string) {
  const steps = await prisma.onboardingStep.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })

  const completed = steps.filter((s) => s.completed).length
  const total = steps.length

  return {
    steps,
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    isComplete: completed === total && total > 0,
  }
}

/**
 * Get next onboarding step
 */
export async function getNextOnboardingStep(userId: string) {
  const steps = await prisma.onboardingStep.findMany({
    where: {
      userId,
      completed: false,
    },
    orderBy: { createdAt: 'asc' },
    take: 1,
  })

  return steps[0] || null
}

/**
 * Skip onboarding step
 */
export async function skipOnboardingStep(
  userId: string,
  step: string
): Promise<void> {
  await prisma.onboardingStep.update({
    where: {
      userId_step: { userId, step },
    },
    data: {
      completed: true,
      completedAt: new Date(),
      data: { skipped: true },
    },
  })
}

/**
 * Reset onboarding
 */
export async function resetOnboarding(userId: string): Promise<void> {
  await prisma.onboardingStep.updateMany({
    where: { userId },
    data: {
      completed: false,
      completedAt: null,
      data: Prisma.JsonNull,
    },
  })

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboarded: false,
      onboardingStep: 0,
    },
  })
}

/**
 * Check if step is completed
 */
export async function isStepCompleted(
  userId: string,
  step: string
): Promise<boolean> {
  const onboardingStep = await prisma.onboardingStep.findUnique({
    where: {
      userId_step: { userId, step },
    },
  })

  return onboardingStep?.completed || false
}

/**
 * Get onboarding stats (admin)
 */
export async function getOnboardingStats() {
  const allUsers = await prisma.user.count()
  const onboardedUsers = await prisma.user.count({
    where: { onboarded: true },
  })

  const allSteps = await prisma.onboardingStep.findMany()

  const stepStats = new Map<string, { total: number; completed: number }>()

  for (const step of allSteps) {
    const stats = stepStats.get(step.step) || { total: 0, completed: 0 }
    stats.total++
    if (step.completed) stats.completed++
    stepStats.set(step.step, stats)
  }

  const stepCompletionRates = Array.from(stepStats.entries()).map(
    ([step, stats]) => ({
      step,
      total: stats.total,
      completed: stats.completed,
      rate: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
    })
  )

  return {
    totalUsers: allUsers,
    onboardedUsers,
    onboardedRate: allUsers > 0 ? (onboardedUsers / allUsers) * 100 : 0,
    stepCompletionRates,
  }
}

/**
 * Get incomplete onboarding users
 */
export async function getIncompleteOnboardingUsers(limit = 100) {
  return await prisma.user.findMany({
    where: {
      onboarded: false,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Trigger onboarding reminder
 */
export async function sendOnboardingReminder(userId: string): Promise<void> {
  const progress = await getOnboardingProgress(userId)

  if (!progress.isComplete) {
    const nextStep = await getNextOnboardingStep(userId)

    await createNotification({
      userId,
      title: 'Complete Your Onboarding',
      message: `You're ${progress.percentage}% done! Next step: ${nextStep?.step || 'Continue'}`,
      type: 'info',
      actionUrl: '/dashboard/onboarding',
    })
  }
}
