/**
 * Device Session Management
 * - Track user devices
 * - Manage trusted devices
 * - Detect suspicious logins
 * - Remote session termination
 */

import { prisma } from './prisma'
import { createHash } from 'crypto'
import UAParser from 'ua-parser-js'

/**
 * Generate device ID from user agent and other factors
 */
export function generateDeviceId(userAgent: string, ipAddress: string): string {
  const hash = createHash('sha256')
  hash.update(`${userAgent}:${ipAddress}`)
  return hash.digest('hex')
}

/**
 * Parse user agent
 */
export function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent)
  const result = parser.getResult()

  return {
    browser: result.browser.name || 'Unknown',
    browserVersion: result.browser.version || '',
    os: result.os.name || 'Unknown',
    osVersion: result.os.version || '',
    device: result.device.type || 'desktop',
    deviceModel: result.device.model || '',
  }
}

/**
 * Register or update device session
 */
export async function registerDeviceSession(params: {
  userId: string
  userAgent: string
  ipAddress: string
  location?: string
}) {
  const { userId, userAgent, ipAddress, location } = params
  const deviceId = generateDeviceId(userAgent, ipAddress)
  const parsed = parseUserAgent(userAgent)

  const deviceName = `${parsed.browser} on ${parsed.os}`

  const existing = await prisma.deviceSession.findUnique({
    where: {
      userId_deviceId: { userId, deviceId },
    },
  })

  if (existing) {
    // Update last active time
    return await prisma.deviceSession.update({
      where: { id: existing.id },
      data: {
        lastActive: new Date(),
        ipAddress,
        location,
      },
    })
  }

  // Create new device session
  return await prisma.deviceSession.create({
    data: {
      userId,
      deviceId,
      deviceName,
      deviceType: parsed.device,
      browser: parsed.browser,
      os: parsed.os,
      ipAddress,
      location,
      trusted: false,
    },
  })
}

/**
 * Get user's devices
 */
export async function getUserDevices(userId: string) {
  return await prisma.deviceSession.findMany({
    where: { userId },
    orderBy: { lastActive: 'desc' },
  })
}

/**
 * Check if device is trusted
 */
export async function isDeviceTrusted(
  userId: string,
  userAgent: string,
  ipAddress: string
): Promise<boolean> {
  const deviceId = generateDeviceId(userAgent, ipAddress)

  const device = await prisma.deviceSession.findUnique({
    where: {
      userId_deviceId: { userId, deviceId },
    },
  })

  return device?.trusted || false
}

/**
 * Trust a device
 */
export async function trustDevice(
  userId: string,
  deviceId: string
): Promise<void> {
  await prisma.deviceSession.updateMany({
    where: { userId, deviceId },
    data: { trusted: true },
  })
}

/**
 * Revoke device trust
 */
export async function revokeDevice(
  userId: string,
  deviceId: string
): Promise<void> {
  await prisma.deviceSession.delete({
    where: {
      userId_deviceId: { userId, deviceId },
    },
  })
}

/**
 * Detect new device login
 */
export async function isNewDevice(
  userId: string,
  userAgent: string,
  ipAddress: string
): Promise<boolean> {
  const deviceId = generateDeviceId(userAgent, ipAddress)

  const existing = await prisma.deviceSession.findUnique({
    where: {
      userId_deviceId: { userId, deviceId },
    },
  })

  return !existing
}

/**
 * Clean up old device sessions
 */
export async function cleanupOldDevices(
  userId: string,
  keepDays = 90
): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - keepDays)

  const result = await prisma.deviceSession.deleteMany({
    where: {
      userId,
      lastActive: { lt: cutoff },
      trusted: false,
    },
  })

  return result.count
}

/**
 * Get device session info
 */
export async function getDeviceInfo(
  userId: string,
  deviceId: string
) {
  return await prisma.deviceSession.findUnique({
    where: {
      userId_deviceId: { userId, deviceId },
    },
  })
}

/**
 * Count user's active devices
 */
export async function countActiveDevices(
  userId: string,
  activeDays = 30
): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - activeDays)

  return await prisma.deviceSession.count({
    where: {
      userId,
      lastActive: { gte: cutoff },
    },
  })
}
