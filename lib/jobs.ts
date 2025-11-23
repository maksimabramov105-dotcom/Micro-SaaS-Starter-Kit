/**
 * Background Job Processing System
 * - Email sending jobs
 * - Data export jobs
 * - Cleanup jobs
 * - Analytics aggregation
 * Uses BullMQ with Redis
 */

import { Queue, Worker, Job } from 'bullmq'
import Redis from 'ioredis'

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
})

// Define job types
export type JobType =
  | 'send_email'
  | 'export_data'
  | 'cleanup_sessions'
  | 'aggregate_analytics'
  | 'process_webhook'
  | 'send_notification'

// Job data interfaces
export interface SendEmailJobData {
  to: string
  subject: string
  html: string
}

export interface ExportDataJobData {
  userId: string
  format: 'json' | 'csv'
}

export interface CleanupSessionsJobData {
  olderThanDays: number
}

export interface AggregateAnalyticsJobData {
  startDate: Date
  endDate: Date
}

// Create queues
export const emailQueue = new Queue('emails', { connection })
export const dataQueue = new Queue('data', { connection })
export const maintenanceQueue = new Queue('maintenance', { connection })
export const analyticsQueue = new Queue('analytics', { connection })

/**
 * Add email job
 */
export async function queueEmail(data: SendEmailJobData, options?: {
  priority?: number
  delay?: number
}) {
  return await emailQueue.add('send_email', data, {
    priority: options?.priority || 5,
    delay: options?.delay || 0,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  })
}

/**
 * Add data export job
 */
export async function queueDataExport(data: ExportDataJobData) {
  return await dataQueue.add('export_data', data, {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  })
}

/**
 * Add cleanup job
 */
export async function queueCleanup(data: CleanupSessionsJobData) {
  return await maintenanceQueue.add('cleanup', data, {
    attempts: 1,
  })
}

/**
 * Add analytics aggregation job
 */
export async function queueAnalyticsAggregation(data: AggregateAnalyticsJobData) {
  return await analyticsQueue.add('aggregate', data, {
    attempts: 2,
  })
}

/**
 * Schedule recurring job
 */
export async function scheduleRecurringJob(
  queue: Queue,
  jobName: string,
  data: any,
  cronExpression: string
) {
  return await queue.add(jobName, data, {
    repeat: {
      pattern: cronExpression,
    },
  })
}

/**
 * Email worker processor
 */
export function createEmailWorker() {
  return new Worker(
    'emails',
    async (job: Job<SendEmailJobData>) => {
      const { to, subject, html } = job.data

      // Import email service dynamically to avoid circular deps
      const { sendEmail } = await import('./email')

      await sendEmail({
        to,
        subject,
        html,
      })

      return { sent: true, to }
    },
    {
      connection,
      concurrency: 5, // Process 5 emails at a time
    }
  )
}

/**
 * Data export worker processor
 */
export function createDataExportWorker() {
  return new Worker(
    'data',
    async (job: Job<ExportDataJobData>) => {
      const { userId, format } = job.data

      // Import export service dynamically
      const { exportUserData } = await import('./export')

      const data = await exportUserData(userId)

      // In production, upload to S3 or similar
      // For now, just return the data
      return { exported: true, format, dataSize: JSON.stringify(data).length }
    },
    {
      connection,
      concurrency: 2,
    }
  )
}

/**
 * Cleanup worker processor
 */
export function createCleanupWorker() {
  return new Worker(
    'maintenance',
    async (job: Job<CleanupSessionsJobData>) => {
      const { olderThanDays } = job.data
      const { prisma } = await import('./prisma')

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - olderThanDays)

      // Clean up expired sessions
      const deletedSessions = await prisma.session.deleteMany({
        where: {
          expires: { lt: cutoff },
        },
      })

      // Clean up old device sessions
      const deletedDevices = await prisma.deviceSession.deleteMany({
        where: {
          lastActive: { lt: cutoff },
          trusted: false,
        },
      })

      return {
        deletedSessions: deletedSessions.count,
        deletedDevices: deletedDevices.count,
      }
    },
    {
      connection,
      concurrency: 1,
    }
  )
}

/**
 * Analytics aggregation worker
 */
export function createAnalyticsWorker() {
  return new Worker(
    'analytics',
    async (job: Job<AggregateAnalyticsJobData>) => {
      const { startDate, endDate } = job.data
      const { prisma } = await import('./prisma')

      // Aggregate analytics events
      const events = await prisma.analyticsEvent.groupBy({
        by: ['event'],
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: { event: true },
      })

      return {
        period: { startDate, endDate },
        eventCounts: events.map((e) => ({
          event: e.event,
          count: e._count.event,
        })),
      }
    },
    {
      connection,
      concurrency: 1,
    }
  )
}

/**
 * Initialize all workers
 */
export function initializeWorkers() {
  const workers = [
    createEmailWorker(),
    createDataExportWorker(),
    createCleanupWorker(),
    createAnalyticsWorker(),
  ]

  // Error handling
  workers.forEach((worker) => {
    worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed successfully`)
    })

    worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err)
    })
  })

  return workers
}

/**
 * Get queue stats
 */
export async function getQueueStats(queue: Queue) {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  }
}

/**
 * Get all queue stats
 */
export async function getAllQueueStats() {
  const queues = [
    { name: 'emails', queue: emailQueue },
    { name: 'data', queue: dataQueue },
    { name: 'maintenance', queue: maintenanceQueue },
    { name: 'analytics', queue: analyticsQueue },
  ]

  const stats = await Promise.all(
    queues.map(async ({ name, queue }) => ({
      name,
      ...(await getQueueStats(queue)),
    }))
  )

  return stats
}

/**
 * Pause queue
 */
export async function pauseQueue(queue: Queue) {
  await queue.pause()
}

/**
 * Resume queue
 */
export async function resumeQueue(queue: Queue) {
  await queue.resume()
}

/**
 * Clear queue
 */
export async function clearQueue(queue: Queue) {
  await queue.drain()
  await queue.clean(0, 1000, 'completed')
  await queue.clean(0, 1000, 'failed')
}

/**
 * Schedule daily cleanup job
 */
export async function scheduleDailyCleanup() {
  // Run every day at 2 AM
  return await scheduleRecurringJob(
    maintenanceQueue,
    'daily_cleanup',
    { olderThanDays: 90 },
    '0 2 * * *'
  )
}

/**
 * Schedule hourly analytics aggregation
 */
export async function scheduleHourlyAnalytics() {
  return await scheduleRecurringJob(
    analyticsQueue,
    'hourly_analytics',
    {
      startDate: new Date(Date.now() - 60 * 60 * 1000),
      endDate: new Date(),
    },
    '0 * * * *'
  )
}
