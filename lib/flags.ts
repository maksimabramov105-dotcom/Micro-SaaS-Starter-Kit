/**
 * flags.ts — Server-side feature flag helpers.
 *
 * All flags are read from environment variables so they can be toggled
 * without a code deploy (restart only).  Defaults are always OFF (false)
 * so new features don't accidentally enable themselves in production.
 *
 * Usage (server components / API routes only):
 *   import { isPdfTemplatesV1, isResumeQualityV2 } from '@/lib/flags'
 */

/** WeasyPrint + Jinja2 template picker (Prompt 03). Default OFF. */
export function isPdfTemplatesV1(): boolean {
  return process.env.PDF_TEMPLATES_V1 === 'true'
}

/** STAR/CAR + ATS keyword + self-critique resume pipeline (Prompt 02). Default OFF. */
export function isResumeQualityV2(): boolean {
  return process.env.RESUME_QUALITY_V2 === 'true'
}
