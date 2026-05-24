/**
 * lib/inbox/inbound-utils.ts
 *
 * Pure helper functions for the inbound webhook route.
 * Extracted into this module so they can be unit-tested without
 * importing Next.js server APIs (which require a browser/edge runtime).
 */

import { createHmac, timingSafeEqual } from 'crypto'

// ── Signature verification ─────────────────────────────────────────────────

/**
 * Verify a Resend inbound webhook signature using Svix's algorithm.
 *
 * Resend uses Svix for webhook delivery. Svix signs the concatenated
 * message: `"{svix-id}.{svix-timestamp}.{rawBody}"` with the base64-decoded
 * `whsec_` secret, producing a base64 HMAC-SHA256 digest.
 *
 * The `svix-signature` header contains one or more space-separated values
 * in the format `v1,{base64_hmac}`.
 *
 * @param rawBody       Raw request body string
 * @param sigHeader     Value of the `svix-signature` header
 * @param msgId         Value of the `svix-id` header
 * @param msgTimestamp  Value of the `svix-timestamp` header
 * @param secret        RESEND_WEBHOOK_SECRET (starts with "whsec_")
 */
export function verifyResendSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  msgId?: string | null,
  msgTimestamp?: string | null,
): boolean {
  if (!sigHeader) return false

  // Decode the `whsec_` base64 secret
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')

  // Build the Svix signed message: "{id}.{timestamp}.{body}"
  // Fall back to signing rawBody alone if headers are absent (legacy/non-Svix path)
  const message =
    msgId && msgTimestamp
      ? `${msgId}.${msgTimestamp}.${rawBody}`
      : rawBody

  const expectedB64 = createHmac('sha256', secretBytes)
    .update(message)
    .digest('base64')

  // svix-signature may contain multiple space-separated "v1,{b64}" values
  const sigs = sigHeader.split(' ')
  for (const entry of sigs) {
    const b64 = entry.startsWith('v1,') ? entry.slice(3) : entry
    try {
      const receivedBuf = Buffer.from(b64, 'base64')
      const expectedBuf = Buffer.from(expectedB64, 'base64')
      if (
        receivedBuf.length === expectedBuf.length &&
        timingSafeEqual(receivedBuf, expectedBuf)
      ) {
        return true
      }
    } catch {
      // malformed base64 — skip this entry
    }
  }

  return false
}

// ── Address parsers ────────────────────────────────────────────────────────

/** Parse "Full Name <email>" or bare "email" → { fromName, fromEmail } */
export function parseFrom(raw: string): { fromName: string | null; fromEmail: string } {
  const m = raw.match(/^(.+?)\s*<([^>]+)>$/)
  if (m) return { fromName: m[1].trim() || null, fromEmail: m[2].trim().toLowerCase() }
  return { fromName: null, fromEmail: raw.trim().toLowerCase() }
}

/**
 * Extract inboxHandle and optional applicationId from a "to" address.
 *   "alex-7g3k+clyq7x2pc@inbox.resumeai-bot.ru"
 *      → { handle: "alex-7g3k", applicationId: "clyq7x2pc" }
 *   "alex-7g3k@inbox.resumeai-bot.ru"
 *      → { handle: "alex-7g3k", applicationId: null }
 */
export function parseToAddress(
  to: string,
  inboxDomain: string,
): { handle: string; applicationId: string | null } | null {
  const lower = to.trim().toLowerCase()
  if (!lower.endsWith(`@${inboxDomain}`)) return null

  const local = lower.split('@')[0]
  const plusIdx = local.indexOf('+')

  if (plusIdx >= 0) {
    return {
      handle: local.slice(0, plusIdx),
      applicationId: local.slice(plusIdx + 1) || null,
    }
  }

  return { handle: local, applicationId: null }
}
