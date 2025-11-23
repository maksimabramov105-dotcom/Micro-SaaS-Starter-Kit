/**
 * Advanced Security Features
 * - Password policy enforcement
 * - Login attempt tracking
 * - Account lockout protection
 * - Password history
 * - IP-based security
 */

import { prisma } from './prisma'
import bcrypt from 'bcrypt'

const PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  historyCount: 5, // Can't reuse last 5 passwords
}

const LOCKOUT_POLICY = {
  maxAttempts: 5,
  lockoutDuration: 15 * 60 * 1000, // 15 minutes
  attemptWindow: 30 * 60 * 1000, // 30 minutes
}

/**
 * Validate password against policy
 */
export function validatePasswordPolicy(password: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters`)
  }

  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (PASSWORD_POLICY.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Check if password was used before
 */
export async function checkPasswordHistory(
  userId: string,
  newPassword: string
): Promise<boolean> {
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_POLICY.historyCount,
  })

  for (const record of history) {
    const matches = await bcrypt.compare(newPassword, record.passwordHash)
    if (matches) {
      return false // Password was used before
    }
  }

  return true // Password is new
}

/**
 * Save password to history
 */
export async function savePasswordHistory(
  userId: string,
  passwordHash: string
): Promise<void> {
  // Save new password
  await prisma.passwordHistory.create({
    data: {
      userId,
      passwordHash,
    },
  })

  // Keep only the last N passwords
  const allHistory = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  if (allHistory.length > PASSWORD_POLICY.historyCount) {
    const toDelete = allHistory.slice(PASSWORD_POLICY.historyCount)
    await prisma.passwordHistory.deleteMany({
      where: {
        id: { in: toDelete.map((h) => h.id) },
      },
    })
  }
}

/**
 * Record login attempt
 */
export async function recordLoginAttempt(params: {
  email: string
  ipAddress: string
  userAgent?: string
  success: boolean
  failReason?: string
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: params,
  })
}

/**
 * Check if account is locked
 */
export async function isAccountLocked(email: string): Promise<{
  locked: boolean
  remainingTime?: number
}> {
  const cutoff = new Date(Date.now() - LOCKOUT_POLICY.attemptWindow)

  const recentAttempts = await prisma.loginAttempt.findMany({
    where: {
      email,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'desc' },
  })

  const failedAttempts = recentAttempts.filter((a) => !a.success)

  if (failedAttempts.length >= LOCKOUT_POLICY.maxAttempts) {
    const lastFailure = failedAttempts[0].createdAt
    const lockoutEnd = new Date(lastFailure.getTime() + LOCKOUT_POLICY.lockoutDuration)
    const now = new Date()

    if (now < lockoutEnd) {
      return {
        locked: true,
        remainingTime: lockoutEnd.getTime() - now.getTime(),
      }
    }
  }

  return { locked: false }
}

/**
 * Get failed login attempts
 */
export async function getFailedLoginAttempts(
  email: string,
  hours = 24
): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const count = await prisma.loginAttempt.count({
    where: {
      email,
      success: false,
      createdAt: { gte: cutoff },
    },
  })

  return count
}

/**
 * Get suspicious IPs (high failure rate)
 */
export async function getSuspiciousIPs(
  threshold = 10,
  hours = 24
): Promise<
  Array<{
    ipAddress: string
    attempts: number
    failures: number
  }>
> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const attempts = await prisma.loginAttempt.findMany({
    where: {
      createdAt: { gte: cutoff },
    },
  })

  const ipStats = new Map<
    string,
    { attempts: number; failures: number }
  >()

  for (const attempt of attempts) {
    const stats = ipStats.get(attempt.ipAddress) || {
      attempts: 0,
      failures: 0,
    }
    stats.attempts++
    if (!attempt.success) stats.failures++
    ipStats.set(attempt.ipAddress, stats)
  }

  return Array.from(ipStats.entries())
    .filter(([_, stats]) => stats.failures >= threshold)
    .map(([ipAddress, stats]) => ({
      ipAddress,
      ...stats,
    }))
    .sort((a, b) => b.failures - a.failures)
}

/**
 * Clear login attempts (after successful login)
 */
export async function clearLoginAttempts(email: string): Promise<void> {
  const cutoff = new Date(Date.now() - LOCKOUT_POLICY.attemptWindow)

  await prisma.loginAttempt.deleteMany({
    where: {
      email,
      createdAt: { gte: cutoff },
    },
  })
}
