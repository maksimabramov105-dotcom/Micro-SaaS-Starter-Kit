import { prisma } from './prisma'

export async function isFeatureEnabled(
  featureName: string,
  userId?: string
): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({
    where: { name: featureName },
  })

  if (!flag) return false
  if (!flag.enabled) return false

  // If rollout percentage is 100%, feature is enabled for everyone
  if (flag.rolloutPercentage >= 100) return true

  // If rollout percentage is 0%, feature is disabled for everyone
  if (flag.rolloutPercentage <= 0) return false

  // If userId is provided, use consistent hashing for gradual rollout
  if (userId) {
    const hash = simpleHash(userId + featureName)
    const userPercentage = hash % 100
    return userPercentage < flag.rolloutPercentage
  }

  return false
}

export async function getEnabledFeatures(userId?: string): Promise<string[]> {
  const flags = await prisma.featureFlag.findMany({
    where: { enabled: true },
  })

  const enabledFeatures: string[] = []

  for (const flag of flags) {
    if (await isFeatureEnabled(flag.name, userId)) {
      enabledFeatures.push(flag.name)
    }
  }

  return enabledFeatures
}

export async function createFeatureFlag(
  name: string,
  description?: string,
  enabled = false,
  rolloutPercentage = 0
) {
  return prisma.featureFlag.create({
    data: {
      name,
      description,
      enabled,
      rolloutPercentage,
    },
  })
}

export async function updateFeatureFlag(
  name: string,
  updates: {
    enabled?: boolean
    rolloutPercentage?: number
    description?: string
  }
) {
  return prisma.featureFlag.update({
    where: { name },
    data: updates,
  })
}

export async function getAllFeatureFlags() {
  return prisma.featureFlag.findMany({
    orderBy: { name: 'asc' },
  })
}

// Simple hash function for consistent user assignment
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}
