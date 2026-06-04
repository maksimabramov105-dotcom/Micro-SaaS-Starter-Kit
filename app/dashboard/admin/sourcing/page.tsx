import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { isAdminEmail } from '@/lib/pmf/admin'

export const dynamic = 'force-dynamic'

const STATUSES = ['QUEUED', 'SUBMITTED', 'FAILED', 'INTERVIEW', 'REJECTED', 'OFFER'] as const

/**
 * Phase 2 sourcing funnel — every JobSource appears as its own row so each
 * source's contribution (listings sourced → applications → outcomes) is visible
 * separately. ATS feeders (Greenhouse/Lever/Ashby) apply via CareerOps and so
 * roll up under CAREEROPS; remote boards + Recruitee/Personio show on their own.
 */
export default async function SourcingFunnelPage() {
  const session = await getServerSession(authOptions)
  const isAdmin =
    session?.user?.role === 'admin' || isAdminEmail(session?.user?.email)
  if (!isAdmin) redirect('/dashboard')

  const [appRows, listingRows] = await Promise.all([
    prisma.jobApplication.groupBy({
      by: ['source', 'status'],
      _count: { _all: true },
    }),
    prisma.jobListing.groupBy({
      by: ['source'],
      _count: { _all: true },
    }),
  ])

  // Pivot into one row per source.
  const sources = Array.from(
    new Set([...appRows.map((r) => r.source), ...listingRows.map((r) => r.source)]),
  ).sort()

  const listingsBySource = new Map(listingRows.map((r) => [r.source, r._count._all]))
  const table = sources.map((source) => {
    const counts: Record<string, number> = {}
    let total = 0
    for (const st of STATUSES) {
      const row = appRows.find((r) => r.source === source && r.status === st)
      counts[st] = row?._count._all ?? 0
      total += counts[st]
    }
    return { source, listings: listingsBySource.get(source) ?? 0, counts, total }
  })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sourcing funnel</h1>
        <Link href="/dashboard/admin" className="text-sm text-emerald-600 hover:underline">
          ← Admin
        </Link>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        Per-source funnel: listings sourced → applications by status. Each job source
        appears separately. Toggle sources via the <code>source_*</code> feature flags.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications by source &amp; status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4 text-right">Listings</th>
                  {STATUSES.map((s) => (
                    <th key={s} className="py-2 pr-4 text-right">{s}</th>
                  ))}
                  <th className="py-2 pr-4 text-right font-semibold">Total apps</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.source} className="border-b">
                    <td className="py-2 pr-4 font-medium">{r.source}</td>
                    <td className="py-2 pr-4 text-right text-gray-500">{r.listings}</td>
                    {STATUSES.map((s) => (
                      <td key={s} className="py-2 pr-4 text-right">{r.counts[s] || ''}</td>
                    ))}
                    <td className="py-2 pr-4 text-right font-semibold">{r.total}</td>
                  </tr>
                ))}
                {table.length === 0 && (
                  <tr><td colSpan={STATUSES.length + 3} className="py-4 text-center text-gray-400">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
