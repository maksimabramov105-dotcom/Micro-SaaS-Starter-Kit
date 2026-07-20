import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'
import { PRICE } from '@/lib/pricing'

export const alt = 'AI Resume Rescue — your resume rewritten for one job'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: `One-time · ${PRICE.rescue}`,
    headline: 'Your resume, rewritten for',
    highlight: 'that exact job.',
    sub: 'Plus a fit report: score breakdown, missing ATS keywords, concrete fixes.',
    pill: 'Delivered in minutes',
    note: 'Auto-refund if we fail',
  })
}
