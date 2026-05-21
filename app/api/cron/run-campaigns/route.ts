/**
 * POST /api/cron/run-campaigns
 *
 * Campaign runner — the missing piece that makes autoapply actually work.
 *
 * For each active CAREEROPS campaign it:
 *   1. Scrapes fresh job listings from Adzuna / RemoteOK / Arbeitnow
 *   2. Saves new listings to JobListing (upsert, dedup by source+externalId)
 *   3. Skips listings the user has already applied to
 *   4. Calls the CareerOps ATS filler worker for each new listing
 *   5. Records a JobApplication row (SUBMITTED or FAILED)
 *   6. Stamps quota via consumeQuota() and fires Redis notification
 *   7. Respects user.dailyApplicationLimit and campaign.dailyLimit
 *   8. Updates campaign.lastRunAt and campaign.totalSent when done
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Called every 2 hours by GitHub Actions (.github/workflows/run-campaigns.yml)
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canSendApplication, consumeQuota } from '@/lib/quota'

// ── Types from worker API ─────────────────────────────────────────────────────

interface ScrapedJob {
  id: string
  title: string
  company: string
  location: string
  salary: string
  url: string
  apply_url: string
  description: string
  source: string
}

interface WorkerJobResult {
  job_id: string
  status: 'running' | 'done' | 'error'
  result?: {
    status: 'submitted' | 'form_not_found' | 'error'
    url?: string
    ats?: string
    error?: string
  }
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractResumeText(generated: unknown): string | null {
  if (!generated || typeof generated !== 'object') return null
  const g = generated as Record<string, unknown>
  if (typeof g.resume_text === 'string') return g.resume_text
  // Fallback: stringify structured content sections
  const parts: string[] = []
  for (const key of Object.keys(g)) {
    const val = g[key]
    if (typeof val === 'string') parts.push(val)
    else if (Array.isArray(val)) parts.push(val.map(String).join('\n'))
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

function splitName(fullName: string | null): { first_name: string; last_name: string } {
  if (!fullName) return { first_name: 'Applicant', last_name: '' }
  const parts = fullName.trim().split(/\s+/)
  return {
    first_name: parts[0] ?? 'Applicant',
    last_name: parts.slice(1).join(' ') ?? '',
  }
}

/** Map scraper source string → Prisma JobSource enum value */
function toJobSource(
  scraperBoard: string
): 'ADZUNA' | 'ARBEITNOW' | 'REMOTEOK' | 'THEMUSE' | 'CAREEROPS' {
  const map: Record<string, 'ADZUNA' | 'ARBEITNOW' | 'REMOTEOK' | 'THEMUSE' | 'CAREEROPS'> = {
    adzuna: 'ADZUNA',
    arbeitnow: 'ARBEITNOW',
    remoteok: 'REMOTEOK',
    themuse: 'THEMUSE',
  }
  return map[scraperBoard.toLowerCase()] ?? 'CAREEROPS'
}

// ── Scraper call ──────────────────────────────────────────────────────────────

async function scrapeBoard(
  workerUrl: string,
  workerSecret: string,
  board: string,
  keywords: string,
  location: string
): Promise<ScrapedJob[]> {
  try {
    const res = await fetch(`${workerUrl}/jobs/scrape/${board}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ keywords, location }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.warn(`[run-campaigns] scrape/${board} returned ${res.status}`)
      return []
    }
    const data = (await res.json()) as WorkerJobResult
    if (data.status !== 'done' || !data.result) return []
    const jobs = (data.result as unknown as { jobs?: ScrapedJob[] }).jobs
    return Array.isArray(jobs) ? jobs : []
  } catch (err) {
    console.warn(`[run-campaigns] scrape/${board} error:`, err)
    return []
  }
}

// ── CareerOps apply call ───────────────────────────────────────────────────────

async function careeropsApply(
  workerUrl: string,
  workerSecret: string,
  applyUrl: string,
  userData: Record<string, string>
): Promise<WorkerJobResult['result']> {
  try {
    const res = await fetch(`${workerUrl}/jobs/autoapply/careerops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        user_id: 0,       // placeholder — worker doesn't use this for DB writes
        campaign_id: 0,   // placeholder — DB writes happen here in the web service
        apply_url: applyUrl,
        user_data: userData,
      }),
      signal: AbortSignal.timeout(120_000), // Playwright can take up to 2 min
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[run-campaigns] careerops returned ${res.status}: ${body}`)
      return { status: 'error', error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as WorkerJobResult
    return data.result ?? { status: 'error', error: data.error ?? 'unknown' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[run-campaigns] careerops error:', msg)
    return { status: 'error', error: msg }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const runAt = new Date().toISOString()
  console.log('[run-campaigns] cron fired', { runAt })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[run-campaigns] unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const workerUrl = (process.env.WORKER_URL ?? 'http://worker:8000').replace(/\/$/, '')
  const workerSecret = process.env.WORKER_SECRET ?? ''

  if (!workerSecret) {
    console.error('[run-campaigns] WORKER_SECRET not set')
    return NextResponse.json({ error: 'WORKER_SECRET not configured' }, { status: 500 })
  }

  // ── Load active CAREEROPS campaigns with user + resume ────────────────────
  const campaigns = await prisma.autoApplyCampaign.findMany({
    where: { isActive: true, source: 'CAREEROPS' },
    include: {
      user: {
        select: { id: true, name: true, email: true, dailyApplicationLimit: true },
      },
      resume: {
        select: { id: true, generated: true, title: true },
      },
    },
  })

  console.log('[run-campaigns] active campaigns', { count: campaigns.length })

  if (campaigns.length === 0) {
    return NextResponse.json({ message: 'No active campaigns', applied: 0 })
  }

  const summary: Array<{
    campaignId: string
    campaignName: string
    applied: number
    failed: number
    skipped: number
    error?: string
  }> = []

  // ── Process each campaign ─────────────────────────────────────────────────
  for (const campaign of campaigns) {
    const { user, resume } = campaign
    const campaignLog: {
      campaignId: string
      campaignName: string
      applied: number
      failed: number
      skipped: number
      error?: string
    } = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      applied: 0,
      failed: 0,
      skipped: 0,
    }

    console.log('[run-campaigns] processing campaign', {
      id: campaign.id,
      name: campaign.name,
      userId: user.id,
      keywords: campaign.keywords,
      locations: campaign.locations,
    })

    // Extract resume text
    const resumeText = extractResumeText(resume.generated)
    if (!resumeText) {
      console.warn('[run-campaigns] no resume text, skipping campaign', campaign.id)
      campaignLog.error = 'No resume text available'
      summary.push(campaignLog)
      continue
    }

    // Build user_data for the ATS filler
    const { first_name, last_name } = splitName(user.name)
    const userData: Record<string, string> = {
      first_name,
      last_name,
      email: user.email ?? '',
      phone: '',
      linkedin_url: '',
      resume_text: resumeText,
      cover_letter: '',
      current_company: '',
      portfolio_url: '',
      location: campaign.locations[0] ?? '',
    }

    // How many more can we send today?
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const sentToday = await prisma.jobApplication.count({
      where: {
        userId: user.id,
        campaignId: campaign.id,
        appliedAt: { gte: today },
        status: { in: ['SUBMITTED', 'INTERVIEW', 'OFFER'] },
      },
    })
    const campaignRemaining = campaign.dailyLimit - sentToday
    if (campaignRemaining <= 0) {
      console.log('[run-campaigns] campaign daily limit reached', campaign.id)
      summary.push(campaignLog)
      continue
    }

    // Collect jobs already applied to (avoid duplicates)
    const appliedUrls = new Set(
      (
        await prisma.jobApplication.findMany({
          where: { userId: user.id },
          select: { jobUrl: true },
        })
      ).map((a) => a.jobUrl)
    )

    // Scrape from multiple boards.
    // - remoteok: uses tag-based search; multi-word queries need simplification
    //   ("software engineer" → "engineer") to get results from the VPS IP.
    // - arbeitnow: 403s from non-EU IPs — skip.
    // - adzuna: requires API keys — skipped if keys not present (scraper handles it).
    // - themuse: works without keys, good coverage.
    const keyword = campaign.keywords[0] ?? 'software engineer'
    const location = campaign.locations[0] ?? ''

    // RemoteOK uses single-word tags; simplify multi-word queries.
    const remoteokTag = keyword.trim().split(/\s+/).pop() ?? 'engineer'

    const scrapedJobs: (ScrapedJob & { board: string })[] = []

    const [adzunaJobs, remoteokJobs, museJobs] = await Promise.all([
      scrapeBoard(workerUrl, workerSecret, 'adzuna', keyword, location),
      scrapeBoard(workerUrl, workerSecret, 'remoteok', remoteokTag, location),
      scrapeBoard(workerUrl, workerSecret, 'themuse', keyword, location),
    ])

    scrapedJobs.push(
      ...adzunaJobs.map((j) => ({ ...j, board: 'adzuna' })),
      ...remoteokJobs.map((j) => ({ ...j, board: 'remoteok' })),
      ...museJobs.map((j) => ({ ...j, board: 'themuse' })),
    )

    console.log('[run-campaigns] scraped', { campaign: campaign.id, total: scrapedJobs.length })

    // Apply to each new job up to the remaining limit
    let appliedThisCampaign = 0

    for (const job of scrapedJobs) {
      if (appliedThisCampaign >= campaignRemaining) break

      const applyUrl = job.apply_url || job.url
      if (!applyUrl) {
        campaignLog.skipped++
        continue
      }

      // Skip already-applied
      if (appliedUrls.has(applyUrl)) {
        campaignLog.skipped++
        continue
      }

      // Skip blocked companies
      if (
        campaign.excludeCompanies.some(
          (blocked) => job.company.toLowerCase().includes(blocked.toLowerCase())
        )
      ) {
        campaignLog.skipped++
        continue
      }

      // Check user quota
      const hasQuota = await canSendApplication(user.id)
      if (!hasQuota) {
        console.log('[run-campaigns] user quota exhausted', user.id)
        break
      }

      // Upsert the JobListing so we have it in DB
      const jobSource = toJobSource(job.board)
      await prisma.jobListing.upsert({
        where: { source_externalId: { source: jobSource, externalId: job.id } },
        create: {
          externalId: job.id,
          source: jobSource,
          title: job.title,
          company: job.company,
          location: job.location ?? '',
          remote: /remote/i.test(job.location ?? ''),
          salary: job.salary ?? '',
          description: job.description ?? '',
          url: job.url,
        },
        update: {
          title: job.title,
          company: job.company,
          description: job.description ?? '',
        },
      })

      // Create JobApplication in QUEUED state first
      const application = await prisma.jobApplication.create({
        data: {
          userId: user.id,
          resumeId: resume.id,
          campaignId: campaign.id,
          source: 'CAREEROPS',
          jobTitle: job.title,
          company: job.company,
          location: job.location ?? '',
          jobUrl: applyUrl,
          vacancyId: job.id,
          status: 'QUEUED',
        },
      })

      // Mark URL as applied to prevent duplicates in this run
      appliedUrls.add(applyUrl)

      // Call the CareerOps worker
      const result = await careeropsApply(workerUrl, workerSecret, applyUrl, userData)

      if (result?.status === 'submitted') {
        // Success — mark SUBMITTED and stamp quota
        await prisma.jobApplication.update({
          where: { id: application.id },
          data: { status: 'SUBMITTED' },
        })
        await consumeQuota(user.id, application.id)
        campaignLog.applied++
        appliedThisCampaign++
        console.log('[run-campaigns] submitted', {
          campaign: campaign.id,
          title: job.title,
          company: job.company,
          ats: result.ats,
        })
      } else {
        // Failed — record error
        const errMsg = result?.error ?? result?.status ?? 'unknown'
        await prisma.jobApplication.update({
          where: { id: application.id },
          data: {
            status: 'FAILED',
            errorMessage: errMsg,
          },
        })
        campaignLog.failed++
        console.warn('[run-campaigns] failed', {
          campaign: campaign.id,
          title: job.title,
          company: job.company,
          error: errMsg,
        })
      }
    }

    // Update campaign stats
    await prisma.autoApplyCampaign.update({
      where: { id: campaign.id },
      data: {
        lastRunAt: new Date(),
        totalSent: { increment: campaignLog.applied },
      },
    })

    summary.push(campaignLog)
  }

  const totalApplied = summary.reduce((s, c) => s + c.applied, 0)
  const totalFailed = summary.reduce((s, c) => s + c.failed, 0)
  const totalSkipped = summary.reduce((s, c) => s + c.skipped, 0)

  console.log('[run-campaigns] complete', { totalApplied, totalFailed, totalSkipped })

  return NextResponse.json({
    runAt,
    campaigns: summary.length,
    totalApplied,
    totalFailed,
    totalSkipped,
    details: summary,
  })
}

// Allow GET for manual browser testing
export async function GET(req: Request) {
  return POST(req)
}
