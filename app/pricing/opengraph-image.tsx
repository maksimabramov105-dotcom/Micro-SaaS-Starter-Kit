import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'
import { PRICE } from '@/lib/pricing'

export const alt = `ResumeAI pricing — free tier, Pro ${PRICE.proMonthly}/month`
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: 'Pricing',
    headline: 'Start free.',
    highlight: `Pro is ${PRICE.proMonthly}/month.`,
    sub: 'Unlimited tailoring, 25 verified auto-applications a day, all templates, reply inbox.',
    pill: `${PRICE.proYearlyPerMo}/mo billed annually`,
    note: '30-day money-back guarantee',
  })
}
