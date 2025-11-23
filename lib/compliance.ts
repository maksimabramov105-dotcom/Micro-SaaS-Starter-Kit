/**
 * Compliance Management System
 * - Cookie consent tracking
 * - Terms & Privacy acceptance
 * - GDPR compliance helpers
 * - Consent version management
 */

import { prisma } from './prisma'
import { createAuditLog } from './audit'

export type ConsentType = 'cookies' | 'terms' | 'privacy' | 'marketing' | 'analytics'

/**
 * Record user consent
 */
export async function recordConsent(params: {
  userId: string
  type: ConsentType
  version: string
  accepted: boolean
  ipAddress?: string
  userAgent?: string
  metadata?: any
}) {
  const { userId, type, version, accepted, ipAddress, userAgent, metadata } = params

  const consent = await prisma.consent.upsert({
    where: {
      userId_type_version: { userId, type, version },
    },
    create: {
      userId,
      type,
      version,
      accepted,
      ipAddress,
      userAgent,
      metadata,
    },
    update: {
      accepted,
      ipAddress,
      userAgent,
      metadata,
    },
  })

  // Audit log
  await createAuditLog({
    userId,
    action: accepted ? 'consent_accepted' : 'consent_rejected',
    resource: 'consent',
    resourceId: consent.id,
    changes: { type, version },
    ipAddress,
    userAgent,
  })

  return consent
}

/**
 * Check if user has accepted consent
 */
export async function hasConsent(
  userId: string,
  type: ConsentType,
  version?: string
): Promise<boolean> {
  const where: any = {
    userId,
    type,
    accepted: true,
  }

  if (version) {
    where.version = version
  }

  const consent = await prisma.consent.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return !!consent
}

/**
 * Get user's consents
 */
export async function getUserConsents(userId: string) {
  return await prisma.consent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Revoke consent
 */
export async function revokeConsent(
  userId: string,
  type: ConsentType,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  // Get latest consent
  const latest = await prisma.consent.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  })

  if (latest) {
    await prisma.consent.update({
      where: { id: latest.id },
      data: {
        accepted: false,
        metadata: {
          ...((latest.metadata as any) || {}),
          revokedAt: new Date(),
        },
      },
    })

    // Audit log
    await createAuditLog({
      userId,
      action: 'consent_revoked',
      resource: 'consent',
      resourceId: latest.id,
      changes: { type, version: latest.version },
      ipAddress,
      userAgent,
    })
  }
}

/**
 * Check if consent needs update (new version available)
 */
export async function needsConsentUpdate(
  userId: string,
  type: ConsentType,
  currentVersion: string
): Promise<boolean> {
  const consent = await prisma.consent.findFirst({
    where: {
      userId,
      type,
      accepted: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!consent) return true

  return consent.version !== currentVersion
}

/**
 * Get consent statistics
 */
export async function getConsentStats(type?: ConsentType) {
  const where: any = {}
  if (type) where.type = type

  const [total, accepted, rejected] = await Promise.all([
    prisma.consent.count({ where }),
    prisma.consent.count({ where: { ...where, accepted: true } }),
    prisma.consent.count({ where: { ...where, accepted: false } }),
  ])

  return {
    total,
    accepted,
    rejected,
    acceptanceRate: total > 0 ? (accepted / total) * 100 : 0,
  }
}

/**
 * Get users who haven't accepted required consent
 */
export async function getUsersWithoutConsent(
  type: ConsentType,
  version: string,
  limit = 100
) {
  // Get all user IDs
  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true, name: true },
  })

  // Get users who have accepted this consent
  const withConsent = await prisma.consent.findMany({
    where: {
      type,
      version,
      accepted: true,
    },
    select: { userId: true },
  })

  const withConsentIds = new Set(withConsent.map((c) => c.userId))

  // Filter users without consent
  return allUsers
    .filter((u) => !withConsentIds.has(u.id))
    .slice(0, limit)
}

/**
 * Cookie consent helper
 */
export async function acceptCookieConsent(
  userId: string,
  preferences: {
    necessary: boolean
    analytics: boolean
    marketing: boolean
  },
  ipAddress?: string,
  userAgent?: string
) {
  const version = '1.0.0' // Update when cookie policy changes

  return await recordConsent({
    userId,
    type: 'cookies',
    version,
    accepted: true,
    ipAddress,
    userAgent,
    metadata: preferences,
  })
}

/**
 * Terms acceptance helper
 */
export async function acceptTerms(
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const version = '1.0.0' // Update when terms change

  return await recordConsent({
    userId,
    type: 'terms',
    version,
    accepted: true,
    ipAddress,
    userAgent,
  })
}

/**
 * Privacy policy acceptance helper
 */
export async function acceptPrivacyPolicy(
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const version = '1.0.0' // Update when privacy policy changes

  return await recordConsent({
    userId,
    type: 'privacy',
    version,
    accepted: true,
    ipAddress,
    userAgent,
  })
}

/**
 * Check if user has all required consents
 */
export async function hasAllRequiredConsents(userId: string): Promise<boolean> {
  const requiredConsents: ConsentType[] = ['terms', 'privacy']

  for (const type of requiredConsents) {
    const hasIt = await hasConsent(userId, type)
    if (!hasIt) return false
  }

  return true
}

/**
 * Export all user consents (GDPR)
 */
export async function exportUserConsents(userId: string) {
  const consents = await getUserConsents(userId)

  return consents.map((c) => ({
    type: c.type,
    version: c.version,
    accepted: c.accepted,
    acceptedAt: c.createdAt,
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
  }))
}

/**
 * Delete all user consents (GDPR right to be forgotten)
 */
export async function deleteUserConsents(userId: string): Promise<void> {
  await prisma.consent.deleteMany({
    where: { userId },
  })
}
