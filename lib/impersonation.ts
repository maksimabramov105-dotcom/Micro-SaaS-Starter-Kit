import { prisma } from './prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth'

export async function canImpersonate(adminId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true },
  })

  return user?.role === 'admin' || user?.role === 'support'
}

export async function startImpersonation(adminId: string, targetUserId: string) {
  // Verify admin has permission
  const hasPermission = await canImpersonate(adminId)
  if (!hasPermission) {
    throw new Error('Insufficient permissions to impersonate users')
  }

  // Log the impersonation
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      action: 'IMPERSONATION_START',
      resource: 'User',
      resourceId: targetUserId,
      changes: {
        adminId,
        targetUserId,
        timestamp: new Date(),
      },
    },
  })

  return {
    impersonating: true,
    originalUserId: adminId,
    targetUserId,
  }
}

export async function endImpersonation(adminId: string, targetUserId: string) {
  // Log the end of impersonation
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      action: 'IMPERSONATION_END',
      resource: 'User',
      resourceId: targetUserId,
      changes: {
        adminId,
        targetUserId,
        timestamp: new Date(),
      },
    },
  })

  return {
    impersonating: false,
  }
}

export async function getImpersonationHistory(userId?: string) {
  return prisma.auditLog.findMany({
    where: {
      action: {
        in: ['IMPERSONATION_START', 'IMPERSONATION_END'],
      },
      ...(userId && { userId }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  })
}
