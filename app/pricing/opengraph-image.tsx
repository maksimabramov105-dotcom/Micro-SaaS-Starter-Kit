import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'ResumeAI pricing — free tier, Pro $19/month'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: 'Pricing',
    headline: 'Start free.',
    highlight: 'Pro is $19/month.',
    sub: 'Unlimited tailoring, 25 verified auto-applications a day, all templates, reply inbox.',
    pill: '$15/mo billed annually',
    note: '30-day money-back guarantee',
  })
}
