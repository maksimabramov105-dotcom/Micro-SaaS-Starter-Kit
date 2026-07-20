import seo from '@/lib/seo-data.json'
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'ResumeAI — a still-running alternative'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image({ params }: { params: Promise<{ competitor: string }> }) {
  const { competitor } = await params
  const c = seo.competitors.find((x) => x.slug === competitor)
  const name = c?.name ?? 'your current tool'
  return ogCard({
    eyebrow: 'Alternative',
    headline: `A ${name} alternative`,
    highlight: 'that verifies every send.',
    sub: 'Per-role tailoring, eligibility checks, and recruiter replies in one inbox.',
    pill: 'Free tier',
    note: '30-day money-back guarantee',
  })
}
