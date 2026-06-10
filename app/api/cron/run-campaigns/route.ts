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

import { NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canSendApplication, consumeQuota } from '@/lib/quota'
import { trackEvent } from '@/lib/analytics-advanced'
import { publishEvent, getRedis } from '@/lib/redis'
import { isResumeQualityV2, isFlagEnabled } from '@/lib/flags'
import {
  tryAcquireLock, releaseLock, resetStaleQueued, saveRunSummary,
  type RunSummary,
} from '@/lib/run-campaigns-ops'
import { inferJobLocation, eligibilityKnockout, type EligibilityProfile } from '@/lib/eligibility'

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Hard cap on Playwright applications PER CAMPAIGN per cron run.
 * Each campaign independently gets up to this many attempts (success or fail).
 * Campaigns run sequentially so peak browser concurrency is always 1.
 *
 * OOM guard: attemptsThisCampaign >= MAX_APPLIES_PER_CAMPAIGN breaks the
 * inner loop so a single runaway campaign can never exhaust VPS memory.
 *
 * The run now executes in the background via after() (see POST), so the real
 * limiter is the wall-clock budget (RUN_BUDGET_MS), not Cloudflare's proxy
 * timeout.  Cross-campaign fairness is handled by a per-campaign time slice
 * (campaignDeadline in the loop below), so this cap is now purely an OOM/runaway
 * ceiling — it should rarely bite.  Actual submissions are still bounded by the
 * user/campaign daily quota regardless of this value.
 */
const MAX_APPLIES_PER_CAMPAIGN = 8

/**
 * Global wall-clock budget (ms) for the entire cron run.
 *
 * The apply loop runs in the background via after() (self-hosted Node server),
 * so it is NOT bounded by Cloudflare's ~100 s proxy timeout anymore — the HTTP
 * response already returned 200 before this loop starts.  We give it a generous
 * budget so each run attempts many jobs across companies.  The cron fires every
 * 2 h, so a multi-minute background run never overlaps the next one.
 *
 * Sizing is driven by MEASURED completion times: a full Greenhouse application
 * ALWAYS requires the emailed security-code step and takes ~60-100 s end to end
 * (fill + submit + poll inbox for the code + resubmit).  So each attempt needs
 * up to ~100 s (PLAYWRIGHT_MAX_TIMEOUT) and only starts with ≥105 s left
 * (PLAYWRIGHT_MIN_BUDGET).  600 s gives a 2-campaign run a fair ~300 s slice
 * each → ~2-3 completing attempts per campaign, and ~5-6 for a single-campaign
 * user.  Attempts run ONE Playwright page at a time (closed in finally), so the
 * budget length does NOT change peak memory — only concurrency would, and that
 * is always 1.  The cron fires every 2 h, so a ~10 min run never overlaps.
 *
 * Any already-running Playwright call is allowed to finish; only new ones
 * are blocked once the budget expires.
 */
// 20 min. The cron now fires every 30 min and a Redis lock prevents overlap, so
// a run may use up to 20 min (leaving a ~10 min buffer) — more sequential applies
// per run WITHOUT raising peak memory (browser concurrency is still 1). [C1(a)]
const RUN_BUDGET_MS = 1_200_000

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
  posted_at?: string   // ISO 8601 — used for freshness ranking (Phase 2)
  remote?: boolean      // adapter-declared remote flag (Phase 2)
}

interface WorkerJobResult {
  job_id: string
  status: 'running' | 'done' | 'error'
  result?: {
    status: 'submitted' | 'form_not_found' | 'error'
    url?: string
    ats?: string
    error?: string
    answers?: Array<{ question: string; answer: string; source: string }>
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

type JobSourceValue =
  | 'ADZUNA' | 'ARBEITNOW' | 'REMOTEOK' | 'THEMUSE' | 'CAREEROPS'
  | 'HIMALAYAS' | 'WWR' | 'RECRUITEE' | 'PERSONIO'

/** Map scraper source string → Prisma JobSource enum value.
 *  ATS feeders (greenhouse/lever/ashby) apply via CareerOps → CAREEROPS.
 *  Remote boards + Recruitee/Personio surface as their own source for the funnel. */
function toJobSource(scraperBoard: string): JobSourceValue {
  const map: Record<string, JobSourceValue> = {
    adzuna: 'ADZUNA',
    arbeitnow: 'ARBEITNOW',
    greenhouse: 'CAREEROPS',
    lever: 'CAREEROPS',
    ashby: 'CAREEROPS',
    remoteok: 'REMOTEOK',
    themuse: 'THEMUSE',
    himalayas: 'HIMALAYAS',
    wwr: 'WWR',
    recruitee: 'RECRUITEE',
    personio: 'PERSONIO',
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
  // Require ALL query words to appear (AND), not any (OR). Previously "customer
  // support" matched "Premium Support Engineer" / "Customer Solution Architect"
  // (engineering roles) because they contained one word — pulling roles the
  // candidate is wrong for. AND keeps it to genuine "customer support" titles.
  return words.every((w) => titleLower.includes(w))
}

// ── Scraper call ──────────────────────────────────────────────────────────────

async function scrapeBoard(
  workerUrl: string,
  workerSecret: string,
  board: string,
  keywords: string,
  location: string,
  timeoutMs = 12_000,
  limit?: number,
): Promise<ScrapedJob[]> {
  try {
    const res = await fetch(`${workerUrl}/jobs/scrape/${board}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ keywords, location, ...(limit ? { limit } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
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

// ── Board-listing → fillable-ATS URL resolver ──────────────────────────────────
// Aggregator boards (RemoteOK/WWR/Himalayas/…) carry huge remote volume but their
// apply_url is an unfillable listing page. Ask the worker to resolve each to a
// real ATS apply URL (follow redirects + scan listing HTML) so CareerOps can fill.
async function resolveBoardUrls(
  workerUrl: string,
  workerSecret: string,
  urls: string[],
  timeoutMs = 20_000,
): Promise<Record<string, string | null>> {
  if (urls.length === 0) return {}
  try {
    const res = await fetch(`${workerUrl}/jobs/resolve-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify({ urls }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      console.warn(`[run-campaigns] resolve-apply returned ${res.status}`)
      return {}
    }
    const data = (await res.json()) as { resolved?: Record<string, string | null> }
    return data.resolved ?? {}
  } catch (err) {
    console.warn('[run-campaigns] resolve-apply error:', err)
    return {}
  }
}

// ── CareerOps apply call ───────────────────────────────────────────────────────

async function careeropsApply(
  workerUrl: string,
  workerSecret: string,
  applyUrl: string,
  userData: Record<string, unknown>,
  timeoutMs = 50_000,  // caller passes remaining budget; hard default 50 s
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
      signal: AbortSignal.timeout(timeoutMs),
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

// ── Job-fit scoring call (Phase 3) ─────────────────────────────────────────────

interface FitScore { score: number; reasons: string[] }

/** Batch-score scraped jobs via the worker's deterministic scorer (no LLM spend). */
async function scoreJobs(
  workerUrl: string,
  workerSecret: string,
  resumeText: string,
  jobs: Array<{ id: string; title: string; description: string; location: string; remote: boolean; country: string }>,
  eligibility: EligibilityProfile,
  languages: string[],
  timeoutMs = 15_000,
): Promise<Map<string, FitScore>> {
  const out = new Map<string, FitScore>()
  if (jobs.length === 0) return out
  try {
    const res = await fetch(`${workerUrl}/jobs/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify({ resume_text: resumeText.slice(0, 6000), jobs, eligibility, languages }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      console.warn('[run-campaigns] score returned', res.status)
      return out
    }
    const data = (await res.json()) as { scores?: Record<string, FitScore> }
    for (const [id, s] of Object.entries(data.scores ?? {})) out.set(id, s)
  } catch (err) {
    console.warn('[run-campaigns] score error:', err instanceof Error ? err.message : String(err))
  }
  return out
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

  // ── Background the entire campaign run ────────────────────────────────────
  //
  // This app is self-hosted (a long-running Node server, NOT serverless), so
  // after() callbacks keep running after the HTTP response is flushed.  We
  // return 200 immediately and run the full apply loop in the background with a
  // generous wall-clock budget (RUN_BUDGET_MS), so each cron run can attempt
  // MANY jobs instead of the ~2 that fit inside Cloudflare's ~100 s proxy
  // timeout when the loop ran inline on the request.
  // ── Distributed lock (P1 audit) ───────────────────────────────────────────
  // The cron now fires every 30 min but a run can take up to RUN_BUDGET_MS
  // (10 min). A SETNX lock with a safety TTL ensures an overlapping fire is
  // SKIPPED rather than starting a second concurrent run (which would double the
  // browser memory on a 1-CPU box and could double-apply). If Redis is
  // unreachable we proceed unlocked (best-effort — preserves prior behaviour).
  const { acquired: lockAcquired, redisReachable } = await tryAcquireLock(getRedis())
  if (redisReachable && !lockAcquired) {
    console.log('[run-campaigns] another run holds the lock — skipping this fire')
    return NextResponse.json({ scheduled: false, reason: 'already-running' })
  }

  after(async () => {
    try {
      await runCampaigns(workerUrl, workerSecret, runAt)
    } catch (err) {
      console.error('[run-campaigns] background run crashed', err)
    } finally {
      if (lockAcquired) await releaseLock(getRedis())
    }
  })

  return NextResponse.json({ scheduled: true, runAt })
}

// ── Background campaign runner ──────────────────────────────────────────────
//
// Contains all the heavy work (Greenhouse pre-scrape, LinkedIn sessions, quota
// distribution, and the CAREEROPS Playwright apply loop).  Runs inside after()
// so it executes after the cron HTTP response has already returned 200, free of
// Cloudflare's proxy timeout.
async function runCampaigns(
  workerUrl: string,
  workerSecret: string,
  runAt: string,
): Promise<void> {
  const runStart = Date.now()

  // ── Self-heal (C2): a previously-killed run can leave JobApplication rows
  // stuck in QUEUED. The dedup below treats QUEUED as "never resend", so those
  // rows would block the job forever. The lock guarantees no other run is
  // mid-flight, so delete QUEUED rows older than the threshold → retryable.
  let staleQueuedReset = 0
  try {
    staleQueuedReset = await resetStaleQueued(prisma)
    if (staleQueuedReset > 0) {
      console.log('[run-campaigns] reset stale QUEUED rows', { count: staleQueuedReset })
    }
  } catch (err) {
    console.warn('[run-campaigns] stale-QUEUED reset failed (non-fatal)', err)
  }

  // ── Load active campaigns with user + resume ─────────────────────────────
  const campaigns = await prisma.autoApplyCampaign.findMany({
    where: { isActive: true, source: { in: ['CAREEROPS', 'LINKEDIN'] } },
    include: {
      user: {
        select: { id: true, name: true, email: true, dailyApplicationLimit: true, inboxHandle: true },
      },
      resume: {
        select: { id: true, generated: true, input: true, title: true },
      },
    },
  })

  console.log('[run-campaigns] active campaigns', { count: campaigns.length })

  if (campaigns.length === 0) {
    console.log('[run-campaigns] no active campaigns')
    return
  }

  // LinkedIn Easy Apply needs the user's LinkedIn email + password to log in.
  // Most users have no LinkedIn account and never enter credentials. Instead of
  // doing nothing for them, a credential-less LinkedIn campaign falls back to
  // the CAREEROPS (Greenhouse) engine, which auto-applies with NO user
  // credentials and whose replies still flow to the in-app inbox. LinkedIn
  // campaigns WITH credentials still use the LinkedIn path.
  const hasLinkedInCreds = (c: (typeof campaigns)[number]): boolean => {
    const enc = (c as { linkedinPasswordEnc?: string | null }).linkedinPasswordEnc
    return Boolean(c.linkedinEmail && enc)
  }
  const careerOpsCampaigns = campaigns.filter(
    (c) => c.source === 'CAREEROPS' || (c.source === 'LINKEDIN' && !hasLinkedInCreds(c)),
  )
  const linkedInCampaigns = campaigns.filter(
    (c) => c.source === 'LINKEDIN' && hasLinkedInCreds(c),
  )
  console.log('[run-campaigns] campaign split', {
    careerOps: careerOpsCampaigns.length,
    linkedIn: linkedInCampaigns.length,
    note: 'credential-less LinkedIn campaigns run via the CAREEROPS engine',
  })

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
    // 20 s timeout — the Greenhouse pre-scrape queries 20 companies in parallel
    // and needs slightly more headroom than the per-campaign board scrapers.
    // limit=5000 (vs the scraper's default 200): the cache is fetched UNFILTERED
    // and each campaign filters it client-side by keyword, so a small cap silently
    // truncated whole role families (e.g. all customer-support roles) before the
    // filter ever saw them. 5000 effectively returns every open role across the
    // curated boards; payload is small (no descriptions on the greenhouse shape).
    const rawGreenhouse = await scrapeBoard(workerUrl, workerSecret, 'greenhouse', '', '', 25_000, 5000)
    runGreenhouseCache = rawGreenhouse.map((j) => ({ ...j, board: 'greenhouse' }))
    console.log('[run-campaigns] greenhouse pre-scrape', { total: runGreenhouseCache.length })
  }

  // ── Phase 2: per-source enable flags ──────────────────────────────────────
  // Evaluated once per run. Each source is independently toggleable, and every
  // scrape is isolated by scrapeBoard's try/catch + timeout, so adding source
  // #10 can never destabilize source #1.
  const SOURCE_FLAGS: Record<string, string> = {
    remoteok: 'source_remoteok', himalayas: 'source_himalayas', wwr: 'source_wwr',
    lever: 'source_lever', ashby: 'source_ashby', recruitee: 'source_recruitee',
    personio: 'source_personio',
  }
  const enabledSources = new Set<string>()
  for (const [board, flag] of Object.entries(SOURCE_FLAGS)) {
    if (await isFlagEnabled(flag)) enabledSources.add(board)
  }
  console.log('[run-campaigns] enabled extra sources', { sources: [...enabledSources] })

  // ── Phase 3: job-fit gate ─────────────────────────────────────────────────
  // The jobfit_min_score flag's rolloutPct doubles as the threshold (0–100):
  // listings scoring below it are skipped instead of queued. Disabled flag →
  // scoring is informational only (nothing gated).
  const fitFlag = await prisma.featureFlag.findUnique({ where: { key: 'jobfit_min_score' } })
  const fitGateEnabled = fitFlag?.enabled ?? false
  const fitThreshold = fitFlag?.rolloutPct ?? 45
  console.log('[run-campaigns] jobfit gate', { fitGateEnabled, fitThreshold })

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

  // ── Per-user quota distribution across CAREEROPS campaigns ──────────────
  //
  // Problem: if a user has multiple CAREEROPS campaigns, Campaign 1 runs first
  // and can exhaust the entire daily user quota before Campaign 2 gets a turn.
  //
  // Fix: for each user with >1 active campaign, divide their remaining daily
  // quota evenly across campaigns (ceil to avoid rounding to zero).  The
  // result is a Map<userId, number> of per-run per-campaign quota caps.
  //
  // Example: user with dailyApplicationLimit=15, 2 campaigns, 12 used today:
  //   remaining = 15 - 12 = 3 → cap per campaign = ceil(3/2) = 2.
  {
    const userCampaignCounts = new Map<string, number>()
    for (const c of careerOpsCampaigns) {
      userCampaignCounts.set(c.user.id, (userCampaignCounts.get(c.user.id) ?? 0) + 1)
    }
    // Only need to cap users with >1 campaign.
    for (const [userId, count] of userCampaignCounts.entries()) {
      if (count <= 1) continue
      const userRec = await prisma.user.findUnique({
        where: { id: userId },
        select: { dailyApplicationLimit: true },
      })
      if (!userRec) continue
      const today2 = new Date(); today2.setHours(0, 0, 0, 0)
      const usedToday = await prisma.jobApplication.count({
        where: {
          userId,
          appliedAt: { gte: today2 },
          status: { in: ['SUBMITTED', 'INTERVIEW', 'OFFER'] },
        },
      })
      const remaining = Math.max(0, userRec.dailyApplicationLimit - usedToday)
      const capPerCampaign = Math.ceil(remaining / count)
      console.log('[run-campaigns] quota distribution', { userId, remaining, count, capPerCampaign })
      // Store cap on each campaign object (transient — not persisted)
      for (const c of careerOpsCampaigns) {
        if (c.user.id === userId) {
          (c as any)._runQuotaCap = capPerCampaign
        }
      }
    }
  }

  // ── Process each CAREEROPS campaign ──────────────────────────────────────
  for (const [campaignIndex, campaign] of careerOpsCampaigns.entries()) {
    const { user, resume } = campaign
    const campaignLog: {
      campaignId: string
      campaignName: string
      userId: string
      applied: number
      failed: number
      skipped: number
      error?: string
      scraped?: number
    } = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      userId: user.id,
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
    // Real contact details live in the resume's raw form input (phone, LinkedIn,
    // location, name). These were previously hardcoded empty, which caused the
    // ATS filler to leave the REQUIRED phone field junk/blank → Greenhouse
    // rejected the submit with "Phone number is too short" (the dominant apply
    // failure). Pull them through so required contact fields validate.
    const resumeInput = (resume.input ?? {}) as Record<string, unknown>
    const inputStr = (k: string): string =>
      typeof resumeInput[k] === 'string' ? (resumeInput[k] as string).trim() : ''

    const { first_name, last_name } = splitName(user.name || inputStr('fullName'))
    const inboxDomain = process.env.INBOX_DOMAIN ?? 'inbox.resumeai-bot.ru'
    const applicationEmail = user.inboxHandle
      ? `${user.inboxHandle}@${inboxDomain}`
      : (user.email ?? inputStr('email'))
    const userData: Record<string, string> = {
      first_name,
      last_name,
      email: applicationEmail,
      phone: inputStr('phone'),
      linkedin_url: inputStr('linkedin') || inputStr('linkedinUrl'),
      resume_text: resumeText,
      cover_letter: '',
      current_company: inputStr('currentCompany') || inputStr('current_company'),
      portfolio_url: inputStr('website') || inputStr('portfolio') || inputStr('portfolioUrl'),
      location: campaign.locations[0] || inputStr('location'),
    }

    // Eligibility profile (Phase 1) — used both for the pre-apply knockout filter
    // below and threaded to the worker so screening answers are honest.
    const eligibility: EligibilityProfile = {
      authorizedCountries: campaign.authorizedCountries,
      needsVisaSponsorship: campaign.needsVisaSponsorship,
      willingToRelocate: campaign.willingToRelocate,
      remoteOnly: campaign.remoteOnly,
      languages: campaign.languages,
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
    // _runQuotaCap is set by the quota-distribution block above for users with
    // >1 active campaign.  It caps this campaign to its fair share of the
    // remaining daily user quota so Campaign 1 cannot exhaust the entire quota
    // before Campaign 2 gets a turn.  Falls back to campaign.dailyLimit for
    // single-campaign users (no change in behaviour).
    const runQuotaCap = (campaign as any)._runQuotaCap ?? campaign.dailyLimit
    const campaignRemaining = Math.min(campaign.dailyLimit - sentToday, runQuotaCap)
    console.log('[run-campaigns] quota state', {
      campaign: campaign.id,
      userId: user.id,
      sentToday,
      campaignDailyLimit: campaign.dailyLimit,
      runQuotaCap,
      campaignRemaining,
      userDailyLimit: user.dailyApplicationLimit,
    })
    if (campaignRemaining <= 0) {
      console.log('[run-campaigns] campaign daily limit reached', campaign.id)
      campaignLog.error = 'daily limit reached'
      summary.push(campaignLog)
      continue
    }

    // Build the dedup set of job URLs to SKIP this run.
    //
    // We must never resubmit a job that genuinely went through, but a job that
    // only FAILED (e.g. a boundary timeout or a transient field-detection miss)
    // SHOULD be retried — especially now that field detection is broader.  So:
    //   - exclude any status that means submitted/in-flight (SUBMITTED, QUEUED,
    //     INTERVIEW, OFFER, REJECTED — anything that is NOT a FAILED attempt)
    //   - allow FAILED jobs to be retried, but only up to MAX_FAILED_RETRIES
    //     times so a permanently-incompatible job stops wasting budget.
    const MAX_FAILED_RETRIES = 3
    const priorApplications = await prisma.jobApplication.findMany({
      where: { userId: user.id },
      select: { jobUrl: true, status: true },
    })
    const appliedUrls = new Set<string>()
    const failedCounts = new Map<string, number>()
    for (const a of priorApplications) {
      if (a.status === 'FAILED') {
        failedCounts.set(a.jobUrl, (failedCounts.get(a.jobUrl) ?? 0) + 1)
      } else {
        // Submitted / queued / interview / offer / rejected — never resend.
        appliedUrls.add(a.jobUrl)
      }
    }
    // Give up on jobs that have already failed too many times.
    for (const [url, count] of failedCounts) {
      if (count >= MAX_FAILED_RETRIES) appliedUrls.add(url)
    }

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
      // ── Phase 2 sources (flag-gated; each isolated by scrapeBoard) ─────────
      // ATS feeders → direct apply URLs CareerOps can fill (Lever/Ashby handlers,
      // generic for Recruitee/Personio). Remote boards → mostly redirect/board
      // URLs that are sourced + funneled but skipped at apply time.
      ...(['lever', 'ashby', 'himalayas', 'wwr', 'recruitee', 'personio'] as const)
        .filter((board) => enabledSources.has(board))
        .map((board) =>
          scrapeBoard(workerUrl, workerSecret, board, keyword, location)
            .then((j) => j.map((x) => ({ ...x, board })))
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

    // Phase 2: prioritize remote + freshly-posted (<72h) before interleaving, so
    // each company's column is fresh/remote-first and the round-robin surfaces the
    // best-eligibility jobs across companies first.
    {
      const now = Date.now()
      const score = (j: ScrapedJob & { board: string }): number => {
        const remote = j.remote === true || /\bremote\b/i.test(j.location ?? '')
        const ts = j.posted_at ? Date.parse(j.posted_at) : NaN
        const fresh = !Number.isNaN(ts) && now - ts < 72 * 3600 * 1000
        return (remote ? 2 : 0) + (fresh ? 1 : 0)
      }
      scrapedJobs.sort((a, b) => score(b) - score(a))
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

    const ghMatched = runGreenhouseCache.filter((j) => keywordMatches(j.title, keyword)).length
    campaignLog.scraped = scrapedJobs.length

    // ── Phase 3: batch job-fit scoring (deterministic; cached on JobListing) ──
    const scoreMap = await scoreJobs(
      workerUrl, workerSecret, resumeText,
      scrapedJobs.map((j) => {
        const loc = inferJobLocation(j.location ?? '', j.title)
        return {
          id: j.id, title: j.title, description: j.description ?? '',
          location: j.location ?? '', remote: j.remote ?? loc.isRemote,
          country: loc.country ?? '',
        }
      }),
      eligibility, eligibility.languages,
    )
    console.log('[run-campaigns] scraped', {
      campaign: campaign.id,
      total: scrapedJobs.length,
      keyword,
      greenhouseMatched: ghMatched,
    })

    // Apply to each new job up to the remaining limit.
    //
    // TWO per-campaign counters:
    //   appliedThisCampaign  — successful SUBMITTED apps (daily-limit tracking)
    //   attemptsThisCampaign — every Playwright attempt, success or fail (OOM cap)
    //
    // The inner loop also checks the global RUN_BUDGET_MS wall-clock guard plus a
    // per-campaign time slice (campaignDeadline) so every campaign gets a turn.
    let appliedThisCampaign = 0
    let attemptsThisCampaign = 0

    // Per-source circuit breaker (C1 rate limiter): if one ATS host returns
    // SOURCE_BACKOFF consecutive failures this run, stop applying to it — this
    // prevents higher throughput from hammering (and getting banned by) a source
    // that's rate-limiting or broken. Reset on the first success.
    const SOURCE_BACKOFF = 3
    const sourceFails = new Map<string, number>()
    const hostOf = (u: string): string => {
      try { return new URL(u).host.toLowerCase() } catch { return 'unknown' }
    }

    // Fair budget sharing across campaigns.
    //
    // Divide the REMAINING wall-clock budget equally among the campaigns that
    // still have to run this invocation.  Without this, the first campaign could
    // spend the entire RUN_BUDGET_MS on its own (possibly failing) attempts and
    // starve every later campaign — they would get 0 attempts on EVERY run, not
    // just this one (campaign order is stable).  Dividing the *remaining* budget
    // means a campaign that finishes early hands its leftover to the next one
    // (whose share is recomputed from what is actually left), while the final
    // campaign always gets the whole remainder.  The global RUN_BUDGET_MS guard
    // below is still the absolute ceiling.
    const campaignsRemainingToRun = careerOpsCampaigns.length - campaignIndex
    const campaignBudgetMs = Math.floor(
      (RUN_BUDGET_MS - (Date.now() - runStart)) / campaignsRemainingToRun
    )
    const campaignDeadline = Date.now() + campaignBudgetMs

    // Hosts whose apply page CareerOps cannot fill in headless Chromium — skip
    // them so we never burn the Playwright budget on guaranteed failures:
    //  - board/aggregator listing pages (apply_url is their own listing, not an ATS form)
    //  - jobs.ashbyhq.com: Ashby's /application is a client-only SPA that renders an
    //    EMPTY shell headless (diagnosed: 0 inputs, body ~113 chars). Reliable Ashby
    //    apply needs a headful/stealth browser → deferred to the VPS-resize phase.
    //    (Ashby/Lever are still SOURCED; only the unfillable Ashby apply is skipped.)
    const BOARD_HOSTS = [
      'remoteok.com', 'themuse.com', 'adzuna.com', 'arbeitnow.com', 'remotive.com',
      'himalayas.app', 'weworkremotely.com', 'jobs.ashbyhq.com',
    ]
    const isBoardUrl = (url: string): boolean =>
      BOARD_HOSTS.some((host) => url.toLowerCase().includes(host))

    // ── Board-redirect resolution (Phase B) ──────────────────────────────
    // Before the apply loop, try to turn unfillable board listings into real
    // ATS apply URLs so CareerOps can submit them — this unlocks the large
    // remote volume on RemoteOK/WWR/Himalayas. Resolved URLs are written back
    // onto the job so the existing isBoardUrl skip naturally lets them through.
    // Bounded (top 40 fresh board jobs) and best-effort; failures just skip as before.
    if (process.env.RESOLVE_BOARD_URLS !== '0') {
      const boardJobs = scrapedJobs.filter((j) => isBoardUrl(j.apply_url || j.url || ''))
      const toResolve = boardJobs.slice(0, 40).map((j) => j.apply_url || j.url || '')
      if (toResolve.length > 0) {
        const resolved = await resolveBoardUrls(workerUrl, workerSecret, toResolve)
        let rewrote = 0
        for (const j of boardJobs) {
          const key = j.apply_url || j.url || ''
          const fillable = resolved[key]
          if (fillable && !isBoardUrl(fillable)) {
            j.apply_url = fillable
            rewrote++
          }
        }
        console.log('[run-campaigns] board-url resolution', {
          campaign: campaign.id,
          boardJobs: boardJobs.length,
          attempted: toResolve.length,
          rewrote,
        })
      }
    }

    // ── Apply dispatch (bounded concurrency, C1) ──────────────────────────
    // APPLY_CONCURRENCY workers pull from scrapedJobs. At the default of 1 this
    // is exactly the previous sequential loop. >1 is only safe after a VPS
    // resize — the worker memory guard refuses to launch a browser without
    // headroom, so the pool degrades gracefully. See docs/SCALING.md.
    const APPLY_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.APPLY_CONCURRENCY ?? '1') || 1))
    let poolStop = false
    let nextJobIdx = 0
    const attemptJob = async (job: (typeof scrapedJobs)[number]): Promise<'next' | 'stop'> => {
      if (appliedThisCampaign >= campaignRemaining) return 'stop'
      // Per-campaign OOM cap: stop if this campaign has used its Playwright budget
      if (attemptsThisCampaign >= MAX_APPLIES_PER_CAMPAIGN) return 'stop'
      // Wall-clock guard for the background run (RUN_BUDGET_MS).
      //
      // Two-part check:
      //   1. Minimum remaining budget — only START a Playwright call if there is
      //      enough budget left to FINISH it including the email-code flow.
      //   2. Dynamic Playwright timeout — caps each fetch to (remaining - 5 s),
      //      max PLAYWRIGHT_MAX_TIMEOUT, so the final attempt cannot overrun the
      //      budget.
      //
      // A full Greenhouse application ALWAYS includes the email-verification
      // step (submit → poll the inbox for the emailed security code → enter it →
      // resubmit) and, per in-container measurement across many companies, takes
      // ~60-100 s end to end — NOT the ~38 s previously assumed.  The old
      // PLAYWRIGHT_MIN_BUDGET=28 s / cap=46 s let an attempt START with far too
      // little budget, so it got capped below its real completion time and
      // aborted ("operation aborted due to timeout") — which is a big reason
      // production submitted ~0.  Now: START only when ≥105 s remains and cap
      // each attempt at 100 s, so a started attempt has time to finish the code
      // flow.  With RUN_BUDGET_MS=600 s and fair per-campaign slices (~300 s for
      // 2 campaigns) this allows ~2-3 attempts/campaign; because scrapedJobs is
      // round-robin interleaved across companies, those attempts hit DIFFERENT
      // companies, so one hard company (e.g. Cloudflare) no longer zeroes the run.
      const PLAYWRIGHT_MIN_BUDGET = 105_000
      const PLAYWRIGHT_MAX_TIMEOUT = 100_000
      const elapsedNow = Date.now() - runStart
      // Honor the tighter of the global run budget and this campaign's fair
      // time slice, so one campaign cannot starve the others.
      const remainingBudget = Math.min(
        RUN_BUDGET_MS - elapsedNow,
        campaignDeadline - Date.now(),
      )
      if (remainingBudget < PLAYWRIGHT_MIN_BUDGET) {
        console.log('[run-campaigns] time budget reached, stopping', {
          elapsed: elapsedNow,
          campaign: campaign.id,
          campaignBudgetMs,
        })
        if (!campaignLog.error) campaignLog.error = `time budget (${elapsedNow}ms)`
        return 'stop'
      }
      const playwrightTimeout = Math.min(PLAYWRIGHT_MAX_TIMEOUT, remainingBudget - 5_000)

      const applyUrl = job.apply_url || job.url
      if (!applyUrl) {
        campaignLog.skipped++
        return 'next'
      }

      // Skip board listing pages — CareerOps needs a direct ATS URL
      if (isBoardUrl(applyUrl)) {
        campaignLog.skipped++
        return 'next'
      }

      // Per-source circuit breaker: stop hitting a host that keeps failing.
      const applyHost = hostOf(applyUrl)
      if ((sourceFails.get(applyHost) ?? 0) >= SOURCE_BACKOFF) {
        campaignLog.skipped++
        return 'next'
      }

      // Skip already-applied
      if (appliedUrls.has(applyUrl)) {
        campaignLog.skipped++
        return 'next'
      }

      // Skip blocked companies
      if (
        campaign.excludeCompanies.some(
          (blocked) => job.company.toLowerCase().includes(blocked.toLowerCase())
        )
      ) {
        campaignLog.skipped++
        return 'next'
      }

      // ── Pre-apply eligibility knockout (Phase 1) ──────────────────────────
      // If the candidate honestly could not win this role (on-site in a country
      // they can't work / remote-only user vs on-site job), SKIP and log the
      // reason WITHOUT creating a JobApplication — so quota is never burned on
      // applications that would claim false authorization.
      const jobLoc = inferJobLocation(job.location ?? '', job.title)
      // Trust the source's explicit remote flag (Ashby isRemote, Lever
      // workplaceType, Himalayas/WWR, etc.) over text-only inference — many
      // genuinely-remote roles list an HQ city as their "location", which would
      // otherwise be wrongly skipped under a remote-only profile.
      const isRemote = (job as { remote?: boolean }).remote === true || jobLoc.isRemote
      const knockout = eligibilityKnockout(eligibility, { country: jobLoc.country, isRemote })
      if (knockout) {
        campaignLog.skipped++
        console.log('[run-campaigns] eligibility skip', {
          campaign: campaign.id,
          company: job.company,
          title: job.title,
          location: job.location,
          jobCountry: jobLoc.country,
          isRemote,
          reason: knockout,
        })
        return 'next'
      }

      // ── Phase 3: job-fit gate ─────────────────────────────────────────────
      // Skip low-fit listings (below the jobfit_min_score threshold) before
      // burning quota. When the gate is disabled the score is still recorded.
      const fit = scoreMap.get(job.id)
      if (fitGateEnabled && fit && fit.score < fitThreshold) {
        campaignLog.skipped++
        console.log('[run-campaigns] low-fit skip', {
          campaign: campaign.id, company: job.company, title: job.title,
          score: fit.score, threshold: fitThreshold, reasons: fit.reasons,
        })
        return 'next'
      }

      // Check user quota
      const hasQuota = await canSendApplication(user.id)
      if (!hasQuota) {
        console.log('[run-campaigns] user quota exhausted', user.id)
        if (!campaignLog.error) campaignLog.error = 'user quota exhausted'
        return 'stop'
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
          fitScore: fit?.score ?? null,
          fitReasons: fit?.reasons ?? [],
        },
        update: {
          title: job.title,
          company: job.company,
          description: job.description ?? '',
          fitScore: fit?.score ?? null,
          fitReasons: fit?.reasons ?? [],
        },
      })

      // Create JobApplication in QUEUED state first. source = the sourcing board
      // (ATS feeders collapse to CAREEROPS) so each source shows in the funnel.
      const application = await prisma.jobApplication.create({
        data: {
          userId: user.id,
          resumeId: resume.id,
          campaignId: campaign.id,
          source: jobSource,
          jobTitle: job.title,
          company: job.company,
          location: job.location ?? '',
          jobUrl: applyUrl,
          vacancyId: job.id,
          status: 'QUEUED',
          fitScore: fit?.score ?? null,
          fitReasons: fit?.reasons ?? [],
        },
      })

      // Mark URL as applied to prevent duplicates in this run
      appliedUrls.add(applyUrl)

      // Call the CareerOps worker (timeout dynamically capped to remaining budget).
      // Pass the company so the worker can match Greenhouse's emailed security
      // code ("Security code for your application to {company}") precisely.
      const result = await careeropsApply(
        workerUrl, workerSecret, applyUrl,
        {
          ...userData,
          _company: job.company,
          eligibility,
          job_country: jobLoc.country ?? '',
        },
        playwrightTimeout,
      )
      attemptsThisCampaign++ // Always count every Playwright call for OOM cap

      // Memory guard signal (C1): the worker refused to launch a browser because
      // the box is low on RAM. Don't record a FAILED attempt (it's transient and
      // would burn a retry) — delete the QUEUED row and stop this run; the next
      // cron fire will pick up where we left off once memory frees.
      if (result?.error?.includes('insufficient_memory')) {
        await prisma.jobApplication.delete({ where: { id: application.id } }).catch(() => {})
        appliedUrls.delete(applyUrl)
        console.warn('[run-campaigns] worker low on memory — pausing run', { campaign: campaign.id, error: result.error })
        if (!campaignLog.error) campaignLog.error = 'insufficient_memory'
        return 'stop'
      }

      if (result?.status === 'submitted') {
        sourceFails.set(applyHost, 0) // healthy source — reset its breaker
        // Success — mark SUBMITTED and stamp quota
        await prisma.jobApplication.update({
          where: { id: application.id },
          data: { status: 'SUBMITTED', appliedAt: new Date() },
        })
        await consumeQuota(user.id, application.id)
        campaignLog.applied++
        appliedThisCampaign++

        // Log the honest screening answers + eligibility context for audit.
        await prisma.applicationEvent.create({
          data: {
            applicationId: application.id,
            type: 'screening',
            payload: {
              eligibility: eligibility as unknown as object,
              jobCountry: jobLoc.country,
              isRemote: jobLoc.isRemote,
              answers: result.answers ?? [],
            },
          },
        }).catch((err: unknown) =>
          console.warn('[run-campaigns] screening event failed', err)
        )

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
        // Failed — bump the per-source breaker and record the error.
        sourceFails.set(applyHost, (sourceFails.get(applyHost) ?? 0) + 1)
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
      return 'next'
    }

    // Drive attemptJob with APPLY_CONCURRENCY workers. At 1 (the default) this is
    // the original sequential loop; >1 runs a bounded pool (each browser still
    // gated by the worker memory guard).
    const runWorker = async (): Promise<void> => {
      while (!poolStop) {
        const job = scrapedJobs[nextJobIdx++]
        if (!job) return
        if ((await attemptJob(job)) === 'stop') { poolStop = true; return }
      }
    }
    await Promise.all(Array.from({ length: APPLY_CONCURRENCY }, () => runWorker()))

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
  // "attempted" = every real Playwright apply call (submitted + failed).
  const totalAttempted = totalApplied + totalFailed

  const runSummary: RunSummary = {
    runAt,
    attempted: totalAttempted,
    submitted: totalApplied,
    failed: totalFailed,
    skipped: totalSkipped,
    staleQueuedReset,
    finishedAt: new Date().toISOString(),
  }
  // Persist for the admin funnel view (best-effort; Redis is non-critical here).
  await saveRunSummary(getRedis(), runSummary)

  console.log('[run-campaigns] complete', {
    ...runSummary,
    campaigns: summary.length,
    durationMs: Date.now() - runStart,
    details: summary,
  })
}

// Allow GET for manual browser testing
export async function GET(req: Request) {
  return POST(req)
}
