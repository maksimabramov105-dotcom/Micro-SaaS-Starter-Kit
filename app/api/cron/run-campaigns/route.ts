/**
 * POST /api/cron/run-campaigns
 *
 * Campaign runner — runs all active autoapply campaigns.
 *
 * For each active CAREEROPS campaign it:
 *   1. Scrapes fresh job listings from Adzuna / RemoteOK / Arbeitnow
 *   2. Saves new listings to JobListing (upsert, dedup by source+externalId)
 *   3. Skips listings the user has already applied to
 *   4. Calls the CareerOps ATS filler worker for each new listing
 *   5. Records a JobApplication row (SUBMITTED or FAILED)
 *   6. Stamps quota via consumeQuota() and publishes application_submitted event
 *   7. Respects user.dailyApplicationLimit and campaign.dailyLimit
 *   8. Updates campaign.lastRunAt and campaign.totalSent when done
 *
 * For each active LINKEDIN campaign it:
 *   1. Calls the LinkedIn Easy Apply worker (1 session per campaign per run)
 *   2. Records JobApplication rows for submitted jobs
 *   3. Publishes application_submitted events for Telegram notifications
 *   4. Note: LinkedIn replies appear in LinkedIn inbox only — not email-trackable
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Called every 2 hours by GitHub Actions (.github/workflows/run-campaigns.yml)
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canSendApplication, consumeQuota } from '@/lib/quota'
import { trackEvent } from '@/lib/analytics-advanced'
import { publishEvent } from '@/lib/redis'
import { isResumeQualityV2 } from '@/lib/flags'

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Hard cap on Playwright applications PER CAMPAIGN per cron run.
 * Each campaign independently gets up to this many attempts (success or fail).
 * Campaigns run sequentially so peak browser concurrency is always 1.
 *
 * OOM guard: attemptsThisCampaign >= MAX_APPLIES_PER_CAMPAIGN breaks the
 * inner loop so a single runaway campaign can never exhaust VPS memory.
 */
const MAX_APPLIES_PER_CAMPAIGN = 3

/**
 * Global wall-clock budget (ms) for the entire cron run.
 * Cloudflare's reverse-proxy read timeout is ~100 s; we stop launching new
 * Playwright attempts at 82 s to guarantee the endpoint returns a JSON body
 * before Cloudflare drops the connection with a 524 error.
 *
 * Any already-running Playwright call is allowed to finish; only new ones
 * are blocked once the budget expires.
 */
const RUN_BUDGET_MS = 82_000

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
    greenhouse: 'CAREEROPS',  // Greenhouse jobs brokered through CareerOps filler
    remoteok: 'REMOTEOK',
    themuse: 'THEMUSE',
  }
  return map[scraperBoard.toLowerCase()] ?? 'CAREEROPS'
}

// ── Keyword matching (mirrors Python greenhouse._keyword_matches) ─────────────
//
// Returns true if ANY word from `keywords` appears in `title`.
// Used to filter the run-level Greenhouse cache per campaign without re-querying
// the API — this avoids Greenhouse rate-limiting when multiple campaigns run
// sequentially in the same cron invocation.

function keywordMatches(title: string, keywords: string): boolean {
  if (!keywords) return true
  const words = keywords.toLowerCase().split(/[\s,/\-]+/).filter(Boolean)
  const titleLower = title.toLowerCase()
  return words.some((w) => titleLower.includes(w))
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
  const runStart = Date.now()
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

  // ── Load active campaigns with user + resume ─────────────────────────────
  const campaigns = await prisma.autoApplyCampaign.findMany({
    where: { isActive: true, source: { in: ['CAREEROPS', 'LINKEDIN'] } },
    include: {
      user: {
        select: { id: true, name: true, email: true, dailyApplicationLimit: true, inboxHandle: true },
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

  const careerOpsCampaigns = campaigns.filter((c) => c.source === 'CAREEROPS')
  const linkedInCampaigns = campaigns.filter((c) => c.source === 'LINKEDIN')

  // ── Pre-scrape Greenhouse ONCE for the entire run ─────────────────────────
  //
  // Problem: when two CAREEROPS campaigns run sequentially in the same cron
  // invocation, both call the Greenhouse API (20 company boards each).
  // The second batch hits Greenhouse immediately after the first — the API
  // rate-limits the VPS IP and returns empty/error responses, so Campaign 2
  // ends up with near-zero jobs.
  //
  // Fix: query all 20 Greenhouse boards ONE time per run with no keyword filter
  // (returns ALL ~200 open roles).  Each campaign then filters this shared
  // result set client-side using keywordMatches() — no repeated API calls.
  //
  // Only bother if there is at least one CAREEROPS campaign that needs jobs.
  let runGreenhouseCache: (ScrapedJob & { board: string })[] = []
  if (careerOpsCampaigns.length > 0) {
    const rawGreenhouse = await scrapeBoard(workerUrl, workerSecret, 'greenhouse', '', '')
    runGreenhouseCache = rawGreenhouse.map((j) => ({ ...j, board: 'greenhouse' }))
    console.log('[run-campaigns] greenhouse pre-scrape', { total: runGreenhouseCache.length })
  }

  const summary: Array<{
    campaignId: string
    campaignName: string
    applied: number
    failed: number
    skipped: number
    error?: string
  }> = []

  // ── Process LinkedIn campaigns ────────────────────────────────────────────
  // LinkedIn Easy Apply: 1 session per campaign per cron run (max 30 apps/session,
  // 2-3 min between apps). GitHub Actions timeout is 600s — cap at 1 session total.
  for (const campaign of linkedInCampaigns) {
    const { user, resume } = campaign

    const linkedinEmail = campaign.linkedinEmail
    const linkedinPasswordEnc = (campaign as any).linkedinPasswordEnc as string | null
    if (!linkedinEmail || !linkedinPasswordEnc) {
      console.warn('[run-campaigns] LinkedIn campaign missing credentials, skipping', campaign.id)
      summary.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        applied: 0, failed: 0, skipped: 0,
        error: 'No LinkedIn credentials on campaign',
      })
      continue
    }

    const keyword = campaign.keywords[0] ?? 'software engineer'
    const location = campaign.locations[0] ?? ''

    console.log('[run-campaigns] linkedin campaign', { id: campaign.id, keyword, location })

    try {
      const res = await fetch(`${workerUrl}/jobs/autoapply/linkedin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          user_id: 0,
          campaign_id: 0,
          email: linkedinEmail,
          password_encrypted: linkedinPasswordEnc,
          job_title: keyword,
          location,
        }),
        signal: AbortSignal.timeout(300_000), // 5 min max (LinkedIn sessions are slow)
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.warn('[run-campaigns] linkedin worker returned', res.status, body)
        summary.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          applied: 0, failed: 0, skipped: 0,
          error: `Worker HTTP ${res.status}`,
        })
        continue
      }

      const data = (await res.json()) as {
        status: string
        result?: { applied_count: number; results: Array<{ success: boolean; job_url: string; job_title?: string; company?: string; error?: string }> }
      }

      const result = data.result
      let liApplied = 0
      let liFailed = 0

      if (result?.results) {
        for (const r of result.results) {
          const hasQuota = await canSendApplication(user.id)
          if (!hasQuota) break

          if (r.success) {
            // Create application record
            const application = await prisma.jobApplication.create({
              data: {
                userId: user.id,
                resumeId: resume.id,
                campaignId: campaign.id,
                source: 'LINKEDIN',
                jobTitle: r.job_title ?? keyword,
                company: r.company ?? '',
                location,
                jobUrl: r.job_url,
                vacancyId: r.job_url, // use URL as unique ID for LinkedIn jobs
                status: 'SUBMITTED',
                appliedAt: new Date(),
              },
            })
            await consumeQuota(user.id, application.id)
            liApplied++

            // Publish Telegram notification
            publishEvent('application_events', {
              type: 'application_submitted',
              userId: user.id,
              applicationId: application.id,
              jobTitle: r.job_title ?? keyword,
              company: r.company ?? '',
              timestamp: new Date().toISOString(),
            }).catch(() => {})
          } else {
            liFailed++
          }
        }
      }

      await prisma.autoApplyCampaign.update({
        where: { id: campaign.id },
        data: { lastRunAt: new Date(), totalSent: { increment: liApplied } },
      })

      summary.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        applied: liApplied, failed: liFailed, skipped: 0,
      })
      console.log('[run-campaigns] linkedin done', { campaign: campaign.id, liApplied, liFailed })

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[run-campaigns] linkedin error', { campaign: campaign.id, msg })
      summary.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        applied: 0, failed: 0, skipped: 0,
        error: msg,
      })
    }
  }

  // ── Process each CAREEROPS campaign ──────────────────────────────────────
  for (const campaign of careerOpsCampaigns) {
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

    // Build user_data for the ATS filler.
    //
    // Use inbox email (handle@inbox.resumeai-bot.ru) as the application email
    // so company replies flow through the dashboard inbox system.
    // Fall back to the user's personal email if inbox isn't configured yet.
    const { first_name, last_name } = splitName(user.name)
    const inboxDomain = process.env.INBOX_DOMAIN ?? 'inbox.resumeai-bot.ru'
    const applicationEmail = user.inboxHandle
      ? `${user.inboxHandle}@${inboxDomain}`
      : (user.email ?? '')
    const userData: Record<string, string> = {
      first_name,
      last_name,
      email: applicationEmail,
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

    // Scrape 100+ jobs from multiple boards with multiple keyword variations.
    //
    // RemoteOK: tag-based API.  "software-engineer" returns 0 — use single-word
    //   synonyms.  Each returns ~30 jobs so 4 tags = ~120 unique jobs.
    // TheMuse: keyword categories.  Returns 20 per page; 3 variations = ~60.
    // Adzuna: included if API keys are set (skipped silently otherwise).
    // Arbeitnow: 403 from VPS IP — skip.
    const keyword = campaign.keywords[0] ?? 'software engineer'
    const location = campaign.locations[0] ?? ''

    const scrapedJobs: (ScrapedJob & { board: string })[] = []

    // Run all board/keyword combos in parallel for speed.
    //
    // Board strategy:
    //   greenhouse — queries 20 major tech companies' Greenhouse ATS boards in
    //                parallel; returns direct job-boards.greenhouse.io URLs that
    //                CareerOps can fill without any page navigation.  This is
    //                the PRIMARY source of workable ATS apply links.
    //   remoteok   — public tag API, 30 jobs/tag; kept for job diversity but
    //                returns remoteOK.com listing pages as apply_url — these
    //                will be filtered out by isBoardUrl() below.
    //   themuse    — kept for job diversity; also returns listing-page URLs so
    //                they will be filtered out too.
    //   adzuna     — included if ADZUNA_APP_ID + ADZUNA_APP_KEY are set.
    const remoteokTags = Array.from(new Set([
      keyword.trim().split(/\s+/).pop() ?? 'engineer',
      keyword.trim().split(/\s+/)[0] ?? 'software',
      'engineer',
      'dev',
    ])).slice(0, 4)

    const museKeywords = Array.from(new Set([
      keyword,
      keyword.replace(/engineer/i, 'developer'),
      'Software Engineer',
    ])).slice(0, 3)

    const allScrapes = await Promise.all([
      // Greenhouse — use the run-level pre-scraped cache (filtered client-side).
      // This avoids a second round of 20 concurrent Greenhouse API calls that
      // would trigger rate-limiting when multiple campaigns run sequentially.
      Promise.resolve(
        runGreenhouseCache.filter((j) => keywordMatches(j.title, keyword))
      ),
      // Adzuna (with keys) — direct company apply URLs when configured
      scrapeBoard(workerUrl, workerSecret, 'adzuna', keyword, location)
        .then((j) => j.map((x) => ({ ...x, board: 'adzuna' }))),
      // RemoteOK — tag variants (board-listing URLs, most will be skipped)
      ...remoteokTags.map((tag) =>
        scrapeBoard(workerUrl, workerSecret, 'remoteok', tag, location)
          .then((j) => j.map((x) => ({ ...x, board: 'remoteok' })))
      ),
      // TheMuse — keyword variants (board-listing URLs, will be skipped)
      ...museKeywords.map((kw) =>
        scrapeBoard(workerUrl, workerSecret, 'themuse', kw, location)
          .then((j) => j.map((x) => ({ ...x, board: 'themuse' })))
      ),
    ])

    // Flatten and deduplicate by apply_url
    const seenUrls = new Set<string>()
    for (const batch of allScrapes) {
      for (const job of batch) {
        const url = job.apply_url || job.url
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url)
          scrapedJobs.push(job)
        }
      }
    }

    // Interleave by company so each cron run applies to jobs from multiple companies
    // rather than exhausting one company (e.g. Cloudflare) before moving to the next.
    //
    // Round-robin: take one job from each company in turn until all are consumed.
    // This ensures that with MAX_APPLIES_PER_RUN=3, applications go to 3 different
    // companies whenever possible.
    {
      const byCompany = new Map<string, (ScrapedJob & { board: string })[]>()
      for (const job of scrapedJobs) {
        const key = job.company.toLowerCase()
        if (!byCompany.has(key)) byCompany.set(key, [])
        byCompany.get(key)!.push(job)
      }
      scrapedJobs.length = 0  // clear in-place
      const columns = Array.from(byCompany.values())
      let idx = 0
      while (columns.some((col) => col.length > 0)) {
        const col = columns[idx % columns.length]
        if (col.length > 0) scrapedJobs.push(col.shift()!)
        idx++
      }
    }

    console.log('[run-campaigns] scraped', { campaign: campaign.id, total: scrapedJobs.length })

    // Apply to each new job up to the remaining limit.
    //
    // TWO per-campaign counters:
    //   appliedThisCampaign  — successful SUBMITTED apps (daily-limit tracking)
    //   attemptsThisCampaign — every Playwright attempt, success or fail (OOM cap)
    //
    // The inner loop also checks the global RUN_BUDGET_MS wall-clock guard so the
    // endpoint always returns within Cloudflare's ~100 s proxy timeout when there
    // are multiple campaigns in a single run.
    let appliedThisCampaign = 0
    let attemptsThisCampaign = 0

    // Job boards whose "apply_url" is their own listing page, not a direct ATS URL.
    // CareerOps fills ATS forms (Greenhouse, Lever, Workable, etc.) and cannot work on
    // these aggregator pages — skip them to avoid spending Playwright budget on timeouts.
    // Note: RemoteOK returns "remoteOK.com" (capital letters) so comparison is lowercased.
    const BOARD_HOSTS = ['remoteok.com', 'themuse.com', 'adzuna.com', 'arbeitnow.com', 'remotive.com']
    const isBoardUrl = (url: string): boolean =>
      BOARD_HOSTS.some((host) => url.toLowerCase().includes(host))

    for (const job of scrapedJobs) {
      if (appliedThisCampaign >= campaignRemaining) break
      // Per-campaign OOM cap: stop if this campaign has used its Playwright budget
      if (attemptsThisCampaign >= MAX_APPLIES_PER_CAMPAIGN) break
      // Global wall-clock guard: stop launching new attempts if we are near the
      // Cloudflare proxy timeout — let the endpoint return cleanly instead of 524.
      if (Date.now() - runStart >= RUN_BUDGET_MS) {
        console.log('[run-campaigns] time budget reached, stopping', { elapsed: Date.now() - runStart })
        break
      }

      const applyUrl = job.apply_url || job.url
      if (!applyUrl) {
        campaignLog.skipped++
        continue
      }

      // Skip board listing pages — CareerOps needs a direct ATS URL
      if (isBoardUrl(applyUrl)) {
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
      attemptsThisCampaign++ // Always count every Playwright call for OOM cap

      if (result?.status === 'submitted') {
        // Success — mark SUBMITTED and stamp quota
        await prisma.jobApplication.update({
          where: { id: application.id },
          data: { status: 'SUBMITTED', appliedAt: new Date() },
        })
        await consumeQuota(user.id, application.id)
        campaignLog.applied++
        appliedThisCampaign++

        // Publish Telegram notification
        publishEvent('application_events', {
          type: 'application_submitted',
          userId: user.id,
          applicationId: application.id,
          jobTitle: job.title,
          company: job.company,
          timestamp: new Date().toISOString(),
        }).catch(() => {})

        // Track resume generation event for quality-v2 A/B analysis
        const usedV2 = await isResumeQualityV2(user.id)
        trackEvent({
          event: 'resume_generated',
          userId: user.id,
          properties: {
            used_v2: usedV2,
            campaign_id: campaign.id,
            job_title: job.title,
            company: job.company,
            ats: result.ats ?? null,
            application_id: application.id,
          },
        }).catch((err: unknown) =>
          console.warn('[run-campaigns] analytics track failed', err)
        )

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
