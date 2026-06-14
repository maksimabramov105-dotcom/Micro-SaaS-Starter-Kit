import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminEmail } from '@/lib/pmf/admin'
import {
  getTodayMetrics,
  getLast30DaysMetrics,
  getCohortRetention,
  getReferralMetrics,
  getExitReasonHistogram,
  getFunnelReport,
  getRevenueMetrics,
  getWeeklyTrends,
  getLastUpdated,
} from '@/lib/pmf/queries'
import sitemap from '@/app/sitemap'

// ── helpers ──────────────────────────────────────────────────────────────

function Tile({
  title,
  value,
  sub,
  accent,
}: {
  title: string
  value: string | number
  sub?: string
  accent?: 'green' | 'red' | 'yellow'
}) {
  const accentClass =
    accent === 'green'
      ? 'text-green-600'
      : accent === 'red'
        ? 'text-red-600'
        : accent === 'yellow'
          ? 'text-yellow-600'
          : 'text-foreground'

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  )
}

function pctStr(v: number | null): string {
  return v === null ? '—' : `${v}%`
}

function pctOf(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 100)
}

function centsStr(cents: number): string {
  const sign = cents >= 0 ? '+' : '-'
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

/** Plain USD (no leading sign), thousands-separated. */
function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Inline SVG sparkline — no chart library (no external BI tool). */
function Sparkline({ data, color = '#059669' }: { data: number[]; color?: string }) {
  const w = 130
  const h = 34
  const pad = 3
  if (data.length === 0) return null
  const min = Math.min(...data, 0)
  const max = Math.max(...data, 1)
  const span = max - min || 1
  const xAt = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1)
  const yAt = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad)
  const pts = data.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')
  const lastX = xAt(data.length - 1)
  const lastY = yAt(data[data.length - 1])
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}

/** One week-over-week trend row: label · sparkline · latest value + WoW delta. */
function TrendRow({
  label,
  data,
  format,
}: {
  label: string
  data: number[]
  format?: (n: number) => string
}) {
  const fmt = format ?? ((n: number) => String(n))
  const last = data[data.length - 1] ?? 0
  const prev = data[data.length - 2] ?? 0
  const delta = last - prev
  const deltaPct = prev !== 0 ? Math.round((delta / Math.abs(prev)) * 100) : null
  const deltaClass = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-muted-foreground'
  return (
    <div className="flex items-center gap-4 border-b py-2.5 last:border-0">
      <span className="w-44 text-sm font-medium">{label}</span>
      <Sparkline data={data} color={delta >= 0 ? '#059669' : '#dc2626'} />
      <span className="ml-auto text-right">
        <span className="block text-lg font-bold tabular-nums">{fmt(last)}</span>
        <span className={`text-xs tabular-nums ${deltaClass}`}>
          {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta))}
          {deltaPct !== null ? ` (${delta >= 0 ? '+' : ''}${deltaPct}%)` : ''} WoW
        </span>
      </span>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────

export default async function PmfDashboardPage() {
  const session = await getServerSession(authOptions)

  if (!isAdminEmail(session?.user?.email)) {
    redirect('/dashboard')
  }

  const [today, last30, cohort, referral, exitReasons, funnel, revenue, weekly] = await Promise.all([
    getTodayMetrics(),
    getLast30DaysMetrics(),
    getCohortRetention(),
    getReferralMetrics(),
    getExitReasonHistogram(),
    getFunnelReport(),
    getRevenueMetrics(),
    getWeeklyTrends(),
  ])

  const updatedAt = getLastUpdated()

  // Week-over-week series (oldest → newest) for the trend lines.
  const trend = {
    signups: weekly.map((w) => w.signups),
    conversions: weekly.map((w) => w.conversions),
    submitted: weekly.map((w) => w.submitted),
    interviews: weekly.map((w) => w.interviews),
    netNewMrr: weekly.map((w) => w.netNewMrrCents),
  }

  // interview rate: prefer survey-based, fall back to app-status-based
  const interviewRate =
    last30.interviewRateSurvey !== null
      ? `${last30.interviewRateSurvey}% (survey)`
      : last30.interviewRateApps !== null
        ? `${last30.interviewRateApps}% (app status)`
        : '—'

  const interviewAccent =
    last30.interviewRateSurvey !== null && last30.interviewRateSurvey >= 10
      ? ('green' as const)
      : last30.interviewRateSurvey !== null && last30.interviewRateSurvey < 5
        ? ('red' as const)
        : undefined

  return (
    <div className="min-h-screen bg-background">
      {/* header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">ResumeAI — PMF Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Admin only · Last updated {updatedAt.toLocaleTimeString()} · Cache TTL 15 min
            </p>
          </div>
          <a href="/dashboard" className="text-xs text-muted-foreground hover:underline">
            ← Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* REVENUE (Stripe-synced) */}
        <Section title="Revenue (Stripe-synced · MRR normalized monthly)">
          <Tile title="MRR" value={usd(revenue.mrrCents)} accent={revenue.mrrCents > 0 ? 'green' : undefined} />
          <Tile title="ARR" value={usd(revenue.arrCents)} sub="MRR × 12" />
          <Tile title="Paying customers" value={revenue.payingCustomers} sub="active, non-expired subs" />
          <Tile title="Blended ARPU" value={usd(revenue.arpuCents)} sub="MRR ÷ paying customers" />
          <Tile
            title="Free → paid conversion"
            value={pctStr(revenue.freeToPaidRate)}
            sub={`${revenue.payingEver} ever-paid of ${revenue.totalUsers} signups`}
          />
          <Tile
            title="Churned MRR (30d)"
            value={usd(revenue.churnedMrrCents)}
            accent={revenue.churnedMrrCents > 0 ? 'red' : undefined}
            sub="cancellations in last 30 days"
          />
        </Section>

        {/* WEEK-OVER-WEEK TRENDS — the single most important investor view */}
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Week-over-week trends (last 8 weeks)
          </h2>
          <div className="rounded-lg border bg-card px-5 py-2 shadow-sm">
            <TrendRow label="Signups" data={trend.signups} />
            <TrendRow label="Free → paid conversions" data={trend.conversions} />
            <TrendRow label="Applications submitted" data={trend.submitted} />
            <TrendRow label="Interviews" data={trend.interviews} />
            <TrendRow label="Net-new MRR" data={trend.netNewMrr} format={(n) => centsStr(n)} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each row: 8-week sparkline · latest week value · change vs. the prior week.
          </p>
        </section>

        {/* ACQUISITION → REVENUE FUNNEL */}
        <Section title="Funnel (last 30 days)">
          <Tile title="Signups" value={funnel.signups} />
          <Tile
            title="Created a resume"
            value={funnel.resumeUsers}
            sub={`${pctStr(pctOf(funnel.resumeUsers, funnel.signups))} of signups`}
          />
          <Tile
            title="Created a campaign"
            value={funnel.campaignUsers}
            sub={`${pctStr(pctOf(funnel.campaignUsers, funnel.signups))} of signups`}
          />
          <Tile
            title="Applications submitted"
            value={funnel.submitted}
            sub="honest _verify_submitted gate"
          />
          <Tile
            title="Human replies"
            value={funnel.humanReplies}
            sub="interview · question · rejection"
            accent={funnel.humanReplies > 0 ? 'green' : undefined}
          />
          <Tile
            title="Interviews"
            value={funnel.interviews}
            sub="interview-request replies"
            accent={funnel.interviews > 0 ? 'green' : undefined}
          />
          <Tile
            title="Active paying subscribers"
            value={funnel.activeSubs}
            accent={funnel.activeSubs > 0 ? 'green' : undefined}
          />
          <Tile
            title="SEO pages indexed"
            value={sitemap().length}
            sub="entries in sitemap.xml"
          />
        </Section>

        {/* TODAY */}
        <Section title="Today">
          <Tile title="New free signups" value={today.newFreeSignups} />
          <Tile
            title="Free → Paid conversions"
            value={today.freeToPaidConversions}
            accent={today.freeToPaidConversions > 0 ? 'green' : undefined}
          />
          <Tile
            title="Cancellations"
            value={today.cancellationsToday}
            accent={today.cancellationsToday > 0 ? 'yellow' : undefined}
          />
          <Tile
            title="Net new MRR"
            value={centsStr(today.netNewMrrCents)}
            sub="approx from plan prices"
            accent={
              today.netNewMrrCents > 0
                ? 'green'
                : today.netNewMrrCents < 0
                  ? 'red'
                  : undefined
            }
          />
        </Section>

        {/* LAST 30 DAYS */}
        <Section title="Last 30 days">
          <Tile
            title="Applications submitted"
            value={last30.appsSubmitted}
            sub={`of ${last30.appsTotal} total · ${pctStr(last30.submissionSuccessRate)} success`}
            accent={
              last30.submissionSuccessRate !== null && last30.submissionSuccessRate < 2
                ? 'red'
                : undefined
            }
          />
          <Tile
            title="Interview rate"
            value={interviewRate}
            sub={`target ≥10% · ${last30.appsWithInterview} interview-status apps`}
            accent={interviewAccent}
          />
          <Tile
            title="Apps marked 'Got Job' (offer)"
            value={last30.appsMarkedGotJob}
            accent={last30.appsMarkedGotJob > 0 ? 'green' : undefined}
          />
          <Tile
            title="Cancellations (refund rate)"
            value={`${last30.refundsIssued} (${pctStr(last30.refundRate)})`}
            accent={
              last30.refundRate !== null && last30.refundRate > 15 ? 'red' : undefined
            }
          />
        </Section>

        {/* COHORT RETENTION */}
        <Section title="Cohort retention">
          {cohort.map((c) => (
            <Tile
              key={c.days}
              title={`Still subscribed at D${c.days}`}
              value={c.retentionRate !== null ? `${c.retentionRate}%` : '—'}
              sub={
                c.cohortSize > 0
                  ? `${c.stillSubscribed} of ${c.cohortSize} from that cohort`
                  : 'No paid users joined ~' + c.days + ' days ago'
              }
              accent={
                c.retentionRate === null
                  ? undefined
                  : c.days === 30 && c.retentionRate >= 85
                    ? 'green'
                    : c.days === 30 && c.retentionRate < 70
                      ? 'red'
                      : c.days === 60 && c.retentionRate >= 65
                        ? 'green'
                        : c.days === 60 && c.retentionRate < 50
                          ? 'red'
                          : c.days === 90 && c.retentionRate >= 40
                            ? 'green'
                            : c.days === 90 && c.retentionRate < 25
                              ? 'red'
                              : undefined
              }
            />
          ))}
        </Section>

        {/* REFERRAL LOOP */}
        <Section title="Referral loop">
          <Tile
            title="Got-a-job exits this month"
            value={referral.gotJobExitsThisMonth}
            accent={referral.gotJobExitsThisMonth > 0 ? 'green' : undefined}
          />
          <Tile
            title="Referral signups from them"
            value={
              referral.referralCoefficient !== null
                ? `${referral.referralSignups} (×${referral.referralCoefficient.toFixed(2)})`
                : '— (tracking not active)'
            }
          />
        </Section>

        {/* EXIT REASON HISTOGRAM */}
        {exitReasons.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Why people leave (last 30 days)
            </h2>
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              {exitReasons.map((r) => (
                <div key={r.reason} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="w-48 truncate font-medium">{r.label}</span>
                  <div className="flex-1">
                    <div
                      className="h-4 rounded bg-primary/20"
                      style={{
                        width: `${Math.round(
                          (r.count / exitReasons.reduce((s, x) => s + x.count, 0)) * 100
                        )}%`,
                        minWidth: '4px',
                      }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums text-muted-foreground">
                    {r.count}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PMF status summary */}
        <section className="rounded-lg border border-dashed bg-muted/30 px-6 py-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">PMF criteria (all three for 60 days)</p>
          <ul className="space-y-0.5">
            <li>Interview rate ≥ 10% per paying user</li>
            <li>D30 retention ≥ 70% · D90 ≥ 40%</li>
            <li>Referral coefficient ≥ 0.5</li>
          </ul>
          <p className="mt-2 text-xs">
            Source: <code>docs/PMF_FRAMEWORK.md</code>
          </p>
        </section>
      </main>
    </div>
  )
}
