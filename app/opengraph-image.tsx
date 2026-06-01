import { ImageResponse } from 'next/og'

// Auto-wired by Next.js into og:image AND twitter:image for the site.
// Renders a 1200x630 branded card (no external asset needed).
export const alt =
  'ResumeAI-Bot — AI resume builder + auto-apply to jobs in 50+ countries'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          backgroundImage: 'linear-gradient(135deg, #0c3b29 0%, #15803d 55%, #1f9d57 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#34d399',
              color: '#06281b',
              fontSize: 38,
              fontWeight: 800,
            }}
          >
            R
          </div>
          <div style={{ marginLeft: 18, fontSize: 30, fontWeight: 700 }}>ResumeAI-Bot</div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05 }}>
            Land a job abroad.
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.05,
            }}
          >
            <span>AI applies for you in&nbsp;</span>
            <span style={{ color: '#86efac' }}>50+ countries.</span>
          </div>
          <div style={{ marginTop: 24, fontSize: 30, color: '#d1fae5' }}>
            AI builds your resume &amp; auto-applies — while you sleep.
          </div>
        </div>

        {/* CTA row */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#34d399',
              color: '#06281b',
              fontSize: 26,
              fontWeight: 700,
              padding: '16px 30px',
              borderRadius: 999,
            }}
          >
            Start free →
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginLeft: 22,
              border: '2px solid rgba(255,255,255,0.5)',
              color: '#ecfdf5',
              fontSize: 24,
              fontWeight: 600,
              padding: '14px 28px',
              borderRadius: 999,
            }}
          >
            30-day money-back guarantee
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
