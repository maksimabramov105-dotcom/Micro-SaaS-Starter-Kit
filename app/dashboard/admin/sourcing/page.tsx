import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { isAdminEmail } from '@/lib/pmf/admin'

export const dynamic = 'force-dynamic'

type StatusRow = { source: string; status: string; n: bigint }
type EventRow = { source: string; type: string; n: bigint }

// Statuses that mean the application actually reached the ATS.
const SUBMITTED_STATUSES = ['SUBMITTED', 'INTERVIEW', 'REJECTED', 'OFFER']

/**
 * Phase 3 sourcing + reply funnel. Per source:
 *   queued → submitted → confirmed → replied → {interview / rejection / question}
 * plus reply-rate, so you can shift volume toward whatever replies fastest.
 */
export default async function SourcingFunnelPage() {
  const session = await getServerSession(authOptions)
  const isAdmin =
    session?.user?.role === 'admin' || isAdminEmail(session?.user?.email)
  if (!isAdmin) redirect('/dashboard')

  const [statusRows, eventRows, listingRows, avgFit] = await Promise.all([
    prisma.$queryRaw<StatusRow[]>`
      SELECT source::text AS source, status::text AS status, count(*) AS n
      FROM "JobApplication" GROUP BY 1, 2`,
    // Distinct applications per source that have each event type.
    prisma.$queryRaw<EventRow[]>`
      SELECT a.source::text AS source, e.type AS type, count(DISTINCT a.id) AS n
      FROM "JobApplication" a
      JOIN "ApplicationEvent" e ON e."applicationId" = a.id
      GROUP BY 1, 2`,
    prisma.jobListing.groupBy({ by: ['source'], _count: { _all: true } }),
    prisma.$queryRaw<{ source: string; avg: number | null }[]>`
      SELECT source::text AS source, round(avg("fitScore"))::int AS avg
      FROM "JobApplication" WHERE "fitScore" IS NOT NULL GROUP BY 1`,
  ])

  const sources = Array.from(new Set([
    ...statusRows.map((r) => r.source),
    ...listingRows.map((r) => r.source),
  ])).sort()

  const listingsBy = new Map(listingRows.map((r) => [r.source as string, r._count._all]))
  const fitBy = new Map(avgFit.map((r) => [r.source, r.avg]))
  const statusN = (s: string, st: string) =>
    Number(statusRows.find((r) => r.source === s && r.status === st)?.n ?? 0)
  const eventN = (s: string, t: string) =>
    Number(eventRows.find((r) => r.source === s && r.type === t)?.n ?? 0)

  const table = sources.map((s) => {
    const submitted = SUBMITTED_STATUSES.reduce((a, st) => a + statusN(s, st), 0)
    const confirmed = eventN(s, 'confirmed')
    const interview = eventN(s, 'interview_requested')
    const rejection = eventN(s, 'rejected')
    const question = eventN(s, 'recruiter_question')
    const replied = interview + rejection + question
    return {
      source: s,
      listings: listingsBy.get(s) ?? 0,
      avgFit: fitBy.get(s) ?? null,
      queued: statusN(s, 'QUEUED'),
      failed: statusN(s, 'FAILED'),
      submitted,
      confirmed,
      replied,
      interview,
      rejection,
      question,
      replyRate: submitted > 0 ? (replied / submitted) * 100 : 0,
    }
  }).sort((a, b) => b.replyRate - a.replyRate || b.submitted - a.submitted)

  const cols: [string, (r: typeof table[number]) => string | number][] = [
    ['Listings', (r) => r.listings],
    ['Avg fit', (r) => (r.avgFit ?? '—')],
    ['Queued', (r) => r.queued || ''],
    ['Submitted', (r) => r.submitted || ''],
    ['Confirmed', (r) => r.confirmed || ''],
    ['Replied', (r) => r.replied || ''],
    ['Interview', (r) => r.interview || ''],
    ['Rejection', (r) => r.rejection || ''],
    ['Question', (r) => r.question || ''],
  ]

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sourcing &amp; reply funnel</h1>
        <Link href="/dashboard/admin" className="text-sm text-emerald-600 hover:underline">
          ← Admin
        </Link>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        Per-source funnel: listings → submitted → <strong>confirmed</strong> → replied.
        Sorted by <strong>reply-rate</strong> so you can shift volume toward whatever
        replies fastest (typically remote boards + startup ATS &gt;&gt; US-enterprise).
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reply-rate by source</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Source</th>
                  {cols.map(([h]) => (
                    <th key={h} className="py-2 pr-4 text-right">{h}</th>
                  ))}
                  <th className="py-2 pr-4 text-right font-semibold">Reply-rate</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.source} className="border-b">
                    <td className="py-2 pr-4 font-medium">{r.source}</td>
                    {cols.map(([h, get]) => (
                      <td key={h} className="py-2 pr-4 text-right">{get(r)}</td>
                    ))}
                    <td className="py-2 pr-4 text-right font-semibold">
                      {r.submitted > 0 ? `${r.replyRate.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
                {table.length === 0 && (
                  <tr><td colSpan={cols.length + 2} className="py-4 text-center text-gray-400">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Reply-rate = (interview + rejection + question) ÷ submitted. Confirmed = ATS
            confirmation email matched to the application.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
