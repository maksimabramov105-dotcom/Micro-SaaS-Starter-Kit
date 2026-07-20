import { ImageResponse } from 'next/og'

/**
 * lib/og-card.tsx — one branded 1200x630 social card renderer (E4).
 *
 * Every page type gets its own card via a thin app/<route>/opengraph-image.tsx
 * that calls ogCard() with its own headline. Before this, every route
 * inherited the site-wide card, so sharing the tripwire rendered the generic
 * "land a job abroad" image.
 *
 * Next.js auto-wires opengraph-image.tsx into BOTH og:image and twitter:image.
 */
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

export interface OgCardOptions {
  /** Small uppercase line above the headline, e.g. "FREE TOOL". */
  eyebrow: string
  /** The big line. Keep it short — it renders at 64px. */
  headline: string
  /** Optional highlighted continuation of the headline (mint green). */
  highlight?: string
  /** Supporting sentence under the headline. */
  sub: string
  /** Pill text bottom-left (the offer/CTA). */
  pill?: string
  /** Pill text bottom-right (the reassurance). */
  note?: string
}

export function ogCard(opts: OgCardOptions): ImageResponse {
  const { eyebrow, headline, highlight, sub, pill, note } = opts
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
          <div style={{ marginLeft: 18, fontSize: 30, fontWeight: 700 }}>ResumeAI</div>
          <div style={{ marginLeft: 'auto', fontSize: 22, color: '#a7f3d0', letterSpacing: 2 }}>
            {eyebrow.toUpperCase()}
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.05,
            }}
          >
            <span>{headline}</span>
            {highlight ? <span style={{ color: '#86efac' }}>&nbsp;{highlight}</span> : null}
          </div>
          <div style={{ marginTop: 24, fontSize: 29, color: '#d1fae5' }}>{sub}</div>
        </div>

        {/* Bottom pills */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {pill ? (
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
              {pill}
            </div>
          ) : null}
          {note ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginLeft: pill ? 22 : 0,
                border: '2px solid rgba(255,255,255,0.5)',
                color: '#ecfdf5',
                fontSize: 24,
                fontWeight: 600,
                padding: '14px 28px',
                borderRadius: 999,
              }}
            >
              {note}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  )
}
