/**
 * lib/proof.ts — social proof for the homepage (D2).
 *
 * IMPORTANT: real proof only. Fake testimonials/reviews are illegal (FTC 2024
 * fake-reviews rule, EU UCPD). Leave these arrays EMPTY until you have genuine,
 * permissioned quotes/screenshots — the homepage renders nothing when empty.
 */

export interface Testimonial {
  quote: string
  name: string       // first name + last initial is fine
  role: string       // e.g. "Backend Engineer, relocated to Germany"
  /** Optional avatar in /public. */
  avatar?: string
}

export interface ReplyScreenshot {
  /** Image in /public (a real, anonymized recruiter reply / interview invite). */
  src: string
  alt: string
  caption?: string
}

// ── Fill these with REAL, permissioned content. Empty = nothing renders. ──────
export const testimonials: Testimonial[] = []
export const replyScreenshots: ReplyScreenshot[] = []
