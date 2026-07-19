import Link from 'next/link'

/**
 * RescueCtaBlock — contextual conversion block for SEO/marketing pages (A3).
 *
 * Server component, zero client JS: safe to drop into every statically
 * rendered programmatic page. Primary action = the $4.99 tripwire, secondary
 * = free signup. `context` makes the heading match the page's intent
 * (e.g. "a Germany job", "a Greenhouse posting").
 */
export function RescueCtaBlock({ context, refTag }: { context?: string; refTag: string }) {
  return (
    <div
      style={{
        border: '2px solid #4f46e5',
        borderRadius: 12,
        padding: '1.25rem 1.5rem',
        margin: '2rem 0',
      }}
    >
      <p style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.35rem' }}>
        Found {context ?? 'a job posting'} you want?
      </p>
      <p style={{ margin: '0 0 0.9rem', fontSize: '0.95rem' }}>
        Paste the posting and get your resume rewritten for that exact role — plus a fit
        report showing what was getting you filtered out. Delivered in minutes, auto-refund
        if we fail.
      </p>
      <p style={{ margin: 0, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link
          href={`/resume-rescue?ref=${refTag}`}
          style={{
            background: '#4f46e5',
            color: '#fff',
            borderRadius: 8,
            padding: '0.6rem 1rem',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Fix my resume for this job — $4.99
        </Link>
        <Link href={`/ats-check?ref=${refTag}`} style={{ fontWeight: 600 }}>
          or get a free fit score first →
        </Link>
      </p>
    </div>
  )
}
