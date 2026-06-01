// app/compare/page.tsx — static comparison page (server component, SSG).
// Data-driven from lib/seo-data.json so competitor prices/status stay accurate.
import type { Metadata } from 'next'
import Link from 'next/link'
import seo from '@/lib/seo-data.json'

const SITE = seo._meta.site
const competitors = seo.competitors

export const metadata: Metadata = {
  title: 'Compare Auto-Apply Tools (2026): ResumeAI-Bot vs Sonara, LazyApply & More',
  description:
    'Side-by-side comparison of AI auto-apply job tools — countries covered, AI resume tailoring, free tier, money-back guarantee and price. See how ResumeAI-Bot compares.',
  alternates: { canonical: `${SITE}/compare` },
  openGraph: {
    title: 'Compare Auto-Apply Tools (2026) — ResumeAI-Bot',
    description: 'How ResumeAI-Bot compares to other AI auto-apply tools on countries, pricing, free tier and guarantee.',
    url: `${SITE}/compare`,
    siteName: 'ResumeAI-Bot',
    type: 'article',
  },
  twitter: { card: 'summary_large_image' },
}

export default function ComparePage() {
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0' }
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }
  return (
    <article style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.7 }}>
      <h1>Compare AI Auto-Apply Tools (2026)</h1>
      <p>
        Most auto-apply tools are built for US / LinkedIn job seekers. ResumeAI-Bot is built for
        applying <strong>globally — across 50+ countries</strong> — with an AI resume tailored to
        every role, a free tier, and a 30-day money-back guarantee. Here&apos;s how it stacks up.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: '1rem' }}>
          <thead>
            <tr>
              <th style={th}>Tool</th>
              <th style={th}>Countries</th>
              <th style={th}>AI resume per role</th>
              <th style={th}>Free tier</th>
              <th style={th}>30-day money-back</th>
              <th style={th}>Price</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: '#ecfdf5' }}>
              <td style={{ ...td, fontWeight: 700 }}>ResumeAI-Bot</td>
              <td style={td}><strong>50+</strong></td>
              <td style={td}>✅</td>
              <td style={td}>✅ 3/day</td>
              <td style={td}>✅</td>
              <td style={td}>$19.99/mo</td>
              <td style={td}>Active</td>
            </tr>
            {competitors.map((c) => (
              <tr key={c.slug}>
                <td style={td}>
                  <Link href={`/alternatives/${c.slug}`}>{c.name}</Link>
                </td>
                <td style={td}>Limited</td>
                <td style={td}>Limited</td>
                <td style={td}>{c.slug === 'loopcv' || c.slug === 'jobright' ? '✅' : '✕'}</td>
                <td style={td}>—</td>
                <td style={td}>{c.theirPrice}</td>
                <td style={td}>{c.status === 'shut down' ? 'Shut down' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: '2rem' }}>Why ResumeAI-Bot</h2>
      <ul>
        <li><strong>Truly global</strong> — apply across 50+ countries, not just US LinkedIn.</li>
        <li><strong>Tailored per role</strong> — the AI rewrites your resume for each job so it passes the ATS.</li>
        <li><strong>Risk-free to try</strong> — free tier (3 applications/day) and a 30-day money-back guarantee on paid plans.</li>
      </ul>

      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/?ref=seo-compare" style={{ fontWeight: 600 }}>
          Start applying free →
        </Link>
      </p>

      <hr style={{ margin: '2rem 0' }} />
      <p style={{ fontSize: 14 }}>
        Alternatives:{' '}
        {competitors.map((c) => (
          <Link key={c.slug} href={`/alternatives/${c.slug}`} style={{ marginRight: 8 }}>
            {c.name} alternative
          </Link>
        ))}
      </p>
    </article>
  )
}
