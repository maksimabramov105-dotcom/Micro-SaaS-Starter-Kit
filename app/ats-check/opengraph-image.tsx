import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/og-card'

export const alt = 'Free fit check — score your resume against any job'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogCard({
    eyebrow: 'Free tool',
    headline: 'Will your resume',
    highlight: 'pass the ATS?',
    sub: 'Paste a job posting and your resume for an instant match score and the fixes that matter.',
    pill: 'Free — no sign-up',
    note: '3 checks per day',
  })
}
