import { prisma } from './prisma'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export async function createNotification({
  userId,
  title,
  message,
  type = 'info',
  actionUrl,
  metadata,
}: {
  userId: string
  title: string
  message: string
  type?: NotificationType
  actionUrl?: string
  metadata?: any
}) {
  return prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      actionUrl,
      metadata,
    },
  })
}

export async function getUserNotifications(userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly && { read: false }),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  })
}

export async function markNotificationAsRead(notificationId: string, userId: string) {
  return prisma.notification.update({
    where: {
      id: notificationId,
      userId, // Ensure user owns the notification
    },
    data: {
      read: true,
    },
  })
}

export async function markAllNotificationsAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: {
      userId,
      read: false,
    },
    data: {
      read: true,
    },
  })
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      read: false,
    },
  })
}

export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.delete({
    where: {
      id: notificationId,
      userId,
    },
  })
}

// Helper functions for common notification types
export async function notifySubscriptionChange(userId: string, planName: string) {
  return createNotification({
    userId,
    title: 'Subscription Updated',
    message: `Your subscription has been changed to ${planName}`,
    type: 'success',
    actionUrl: '/dashboard/settings',
  })
}

export async function notifyUsageLimit(userId: string, feature: string, limit: number) {
  return createNotification({
    userId,
    title: 'Usage Limit Reached',
    message: `You've reached ${limit}% of your ${feature} quota`,
    type: 'warning',
    actionUrl: '/pricing',
  })
}

export async function notifyTeamInvite(userId: string, teamName: string, inviteUrl: string) {
  return createNotification({
    userId,
    title: 'Team Invitation',
    message: `You've been invited to join ${teamName}`,
    type: 'info',
    actionUrl: inviteUrl,
  })
}
