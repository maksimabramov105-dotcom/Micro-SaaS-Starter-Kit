/**
 * lib/flags.ts
 *
 * In-house feature flag evaluation — Stage 1 (zero external deps).
 * Flags are stored in the DB (`FeatureFlag` model) with an in-memory TTL cache.
 * Stage 2: migrate to PostHog free tier at $5K MRR and replace this file.
 *
 * Server-side only. Usage:
 *   import { isFlagEnabled } from '@/lib/flags'
 *   if (await isFlagEnabled('pdf_templates_v1', session.user.id)) { ... }
 *
 * Legacy shims for Prompts 02 & 03 are kept below so existing call sites work
 * without changes. They now delegate to isFlagEnabled (DB-backed).
 */

import { prisma } from './prisma'
import crypto from 'crypto'

// ── Internal cache ───────────────────────────────────────────────────────────

interface FlagEntry { enabled: boolean; pct: number }
interface Cache { value: Map<string, FlagEntry>; loadedAt: number }

let _cache: Cache | null = null
const TTL_MS = 5 * 60 * 1000 // 5 min — short enough that admin toggles feel instant

async function loadFlags(): Promise<Map<string, FlagEntry>> {
  if (_cache && Date.now() - _cache.loadedAt < TTL_MS) return _cache.value
  const rows = await prisma.featureFlag.findMany()
  const v = new Map(rows.map((r) => [r.key, { enabled: r.enabled, pct: r.rolloutPct }]))
  _cache = { value: v, loadedAt: Date.now() }
  return v
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true when the flag is enabled for `userId`.
 *
 * Evaluation order:
 *  1. Flag absent in DB → false
 *  2. Flag disabled     → false
 *  3. rolloutPct ≥ 100  → true (fully launched)
 *  4. rolloutPct ≤ 0    → false
 *  5. Gradual rollout:  SHA-256(`${key}:${userId}`) → stable 0–99 bucket < pct
 *     Anonymous callers (no userId) always get false for partial rollouts.
 */
export async function isFlagEnabled(key: string, userId?: string): Promise<boolean> {
  const flags = await loadFlags()
  const f = flags.get(key)
  if (!f || !f.enabled) return false
  if (f.pct >= 100) return true
  if (f.pct <= 0) return false
  if (!userId) return false
  const bucket =
    parseInt(
      crypto.createHash('sha256').update(`${key}:${userId}`).digest('hex').slice(0, 8),
      16,
    ) % 100
  return bucket < f.pct
}

/**
 * Invalidate the in-memory cache.
 * Call after updating a flag in the admin UI for immediate effect.
 */
export function invalidateFlagCache(): void {
  _cache = null
}

/** Return all flags (admin UI). */
export async function getAllFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: 'asc' } })
}

/** Upsert a flag (admin API routes). Invalidates cache automatically. */
export async function setFlag(key: string, enabled: boolean, rolloutPct: number) {
  const result = await prisma.featureFlag.upsert({
    where: { key },
    create: { key, enabled, rolloutPct },
    update: { enabled, rolloutPct },
  })
  invalidateFlagCache()
  return result
}

// ── Legacy shims (Prompts 02 & 03) ──────────────────────────────────────────
// These originally read env vars. They now delegate to the DB so the admin UI
// controls them without a redeploy. Pass userId for gradual rollouts.

/** WeasyPrint + Jinja2 template picker (Prompt 03). */
export async function isPdfTemplatesV1(userId?: string): Promise<boolean> {
  return isFlagEnabled('pdf_templates_v1', userId)
}

/** STAR/CAR + ATS keyword + self-critique resume pipeline (Prompt 02). */
export async function isResumeQualityV2(userId?: string): Promise<boolean> {
  return isFlagEnabled('resume_quality_v2', userId)
}
