import { prisma } from './prisma'

export async function createAuditLog({
  userId,
  teamId,
  action,
  resource,
  resourceId,
  changes,
  ipAddress,
  userAgent,
}: {
  userId?: string
  teamId?: string
  action: string
  resource: string
  resourceId?: string
  changes?: any
  ipAddress?: string
  userAgent?: string
}) {
  return prisma.auditLog.create({
    data: {
      userId,
      teamId,
      action,
      resource,
      resourceId,
      changes,
      ipAddress,
      userAgent,
    },
  })
}

export async function getAuditLogs({
  userId,
  teamId,
  resource,
  resourceId,
  limit = 100,
}: {
  userId?: string
  teamId?: string
  resource?: string
  resourceId?: string
  limit?: number
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(userId && { userId }),
      ...(teamId && { teamId }),
      ...(resource && { resource }),
      ...(resourceId && { resourceId }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  })
}

export async function getResourceHistory(resource: string, resourceId: string) {
  return prisma.auditLog.findMany({
    where: {
      resource,
      resourceId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })
}

// Helper functions for common audit actions
export async function auditUserLogin(userId: string, ipAddress?: string, userAgent?: string) {
  return createAuditLog({
    userId,
    action: 'USER_LOGIN',
    resource: 'User',
    resourceId: userId,
    ipAddress,
    userAgent,
  })
}

export async function auditDataExport(userId: string, exportType: string) {
  return createAuditLog({
    userId,
    action: 'DATA_EXPORT',
    resource: 'Export',
    changes: { exportType, timestamp: new Date() },
  })
}

export async function auditSettingsChange(
  userId: string,
  oldSettings: any,
  newSettings: any
) {
  return createAuditLog({
    userId,
    action: 'SETTINGS_UPDATE',
    resource: 'Settings',
    resourceId: userId,
    changes: {
      before: oldSettings,
      after: newSettings,
    },
  })
}

export async function auditTeamAction(
  userId: string,
  teamId: string,
  action: string,
  changes?: any
) {
  return createAuditLog({
    userId,
    teamId,
    action,
    resource: 'Team',
    resourceId: teamId,
    changes,
  })
}
