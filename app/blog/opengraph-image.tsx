import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'ResumeAI blog — honest data from real job applications'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: 'Blog',
    headline: 'Honest data from',
    highlight: 'real applications.',
    sub: 'How many applications actually reach a human, and exactly how automated applying fails.',
    pill: 'Live pipeline numbers',
    note: 'Updated daily',
  })
}
