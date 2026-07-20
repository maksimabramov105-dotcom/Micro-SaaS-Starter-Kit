import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'ResumeAI blog post'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

/** Per-post cards so sharing a post renders its own headline, not the generic one. */
const CARDS: Record<string, { headline: string; highlight: string; sub: string }> = {
  'how-many-applications-reach-a-human': {
    headline: 'How many applications',
    highlight: 'actually reach a human?',
    sub: 'Live numbers from a pipeline where nothing counts until the ATS confirms it.',
  },
  'auto-apply-failure-modes': {
    headline: 'Why auto-apply',
    highlight: 'actually fails.',
    sub: 'Bot walls, stale postings, surprise required fields — measured in production.',
  },
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const card = CARDS[slug] ?? {
    headline: 'Honest data from',
    highlight: 'real applications.',
    sub: 'Computed live from our verified application pipeline.',
  }
  return ogCard({ eyebrow: 'Blog', ...card, pill: 'Live pipeline numbers', note: 'Updated daily' })
}
