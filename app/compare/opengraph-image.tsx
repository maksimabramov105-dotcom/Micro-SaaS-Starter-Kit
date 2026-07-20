import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'ResumeAI vs 10 job-search tools — honest comparison'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: 'Comparison',
    headline: 'Compared against',
    highlight: '10 job-search tools.',
    sub: 'Verified submissions, eligibility checks, and a reply inbox — only the rows we truly win.',
    pill: 'See the table',
    note: 'No invented claims',
  })
}
