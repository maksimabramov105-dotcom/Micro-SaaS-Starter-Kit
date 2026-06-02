import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { isAdminEmail } from '@/lib/pmf/admin'

export const dynamic = 'force-dynamic'

type Row = { label: string; views: number }

export default async function MarketingAnalyticsPage() {
  const session = await getServerSession(authOptions)
  const isAdmin =
    session?.user?.role === 'admin' || isAdminEmail(session?.user?.email)
  if (!isAdmin) redirect('/dashboard')

  const now = new Date()
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    pv7,
    pv30,
    checkout7,
    checkout30,
    leads7,
    leadsTotal,
    paying,
    bySource,
    topPages,
    recent,
  ] = await Promise.all([
    prisma.analyticsEvent.count({ where: { event: 'page_view', createdAt: { gte: since7 } } }),
    prisma.analyticsEvent.count({ where: { event: 'page_view', createdAt: { gte: since30 } } }),
    prisma.analyticsEvent.count({ where: { event: 'checkout_started', createdAt: { gte: since7 } } }),
    prisma.analyticsEvent.count({ where: { event: 'checkout_started', createdAt: { gte: since30 } } }),
    prisma.lead.count({ where: { createdAt: { gte: since7 } } }),
    prisma.lead.count(),
    prisma.user.count({ where: { stripeSubscriptionId: { not: null } } }),
    prisma.$queryRaw<Row[]>`
      SELECT COALESCE(
               NULLIF(properties->>'ref',''),
               NULLIF(split_part(split_part(properties->>'referrer','://',2),'/',1),''),
               'direct'
             ) AS label,
             count(*)::int AS views
      FROM "AnalyticsEvent"
      WHERE event='page_view' AND "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    prisma.$queryRaw<Row[]>`
      SELECT COALESCE(NULLIF(properties->>'path',''),'(unknown)') AS label,
             count(*)::int AS views
      FROM "AnalyticsEvent"
      WHERE event='page_view' AND "createdAt" >= ${since30}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    prisma.analyticsEvent.findMany({
      where: { event: 'page_view' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { createdAt: true, properties: true },
    }),
  ])

  const conv30 = pv30 > 0 ? ((checkout30 / pv30) * 100).toFixed(1) : '0.0'

  const cards = [
    { label: 'Pageviews (7d)', value: pv7, sub: `${pv30} in 30d` },
    { label: 'Checkout starts (7d)', value: checkout7, sub: `${checkout30} in 30d` },
    { label: 'Leads / teardowns (7d)', value: leads7, sub: `${leadsTotal} all-time` },
    { label: 'Paying customers', value: paying, sub: 'active subscriptions' },
  ]

  const prop = (p: unknown, k: string): string => {
    if (p && typeof p === 'object' && k in (p as Record<string, unknown>)) {
      const v = (p as Record<string, unknown>)[k]
      return typeof v === 'string' ? v : ''
    }
    return ''
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Marketing analytics</h1>
        <Link href="/dashboard/admin" className="text-sm text-emerald-600 hover:underline">
          ← Admin
        </Link>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        First-party pageviews &amp; traffic sources (from <code>AnalyticsEvent</code>). Tag your
        links with <code>?ref=</code> so each channel shows up below.
      </p>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
              <p className="text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Funnel (30 days)</CardTitle>
            <CardDescription>
              {pv30} pageviews → {checkout30} checkout starts ({conv30}% start rate). {leadsTotal}{' '}
              leads captured all-time.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic by source (30d)</CardTitle>
            <CardDescription>?ref tag, else referrer host, else direct</CardDescription>
          </CardHeader>
          <CardContent>
            <Table rows={bySource} unit="views" empty="No pageviews yet — share a ?ref-tagged link." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top pages (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table rows={topPages} unit="views" empty="No pageviews yet." />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent pageviews</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Time</th>
                    <th className="py-2 pr-4 font-medium">Path</th>
                    <th className="py-2 pr-4 font-medium">Source</th>
                    <th className="py-2 font-medium">Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-muted-foreground">No pageviews recorded yet.</td></tr>
                  )}
                  {recent.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                        {new Date(r.createdAt).toISOString().slice(5, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-4">{prop(r.properties, 'path') || '—'}</td>
                      <td className="py-2 pr-4">{prop(r.properties, 'ref') || '—'}</td>
                      <td className="py-2 max-w-[260px] truncate text-muted-foreground">
                        {prop(r.properties, 'referrer') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Table({ rows, unit, empty }: { rows: Row[]; unit: string; empty: string }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  const max = Math.max(...rows.map((r) => r.views), 1)
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <div className="w-40 shrink-0 truncate" title={r.label}>{r.label}</div>
          <div className="h-4 flex-1 rounded bg-slate-100">
            <div
              className="h-4 rounded bg-emerald-500"
              style={{ width: `${Math.max(4, (r.views / max) * 100)}%` }}
            />
          </div>
          <div className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
            {r.views} {unit}
          </div>
        </div>
      ))}
    </div>
  )
}
