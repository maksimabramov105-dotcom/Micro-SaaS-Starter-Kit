import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPlanByPriceId } from '@/lib/pricing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

// Pause/resume an autoapply campaign.
//
// Runs as a Server Action invoked directly from the form (see CampaignToggleForm).
// The previous implementation fetched /api/campaigns/[id]/toggle from inside a
// server action — but a server-to-self fetch carries no session cookie, so the
// route's getServerSession() returned null and the toggle silently 401'd.
// Mutating the DB directly here keeps the user's session in scope and lets us
// revalidate the dashboard so the button label flips immediately.
async function toggleCampaign(id: string) {
  'use server'
  const session = await getServerSession(authOptions)
  if (!session?.user) return

  // Scope by userId so a user can only toggle their own campaigns.
  const campaign = await prisma.autoApplyCampaign.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, isActive: true },
  })
  if (!campaign) return

  await prisma.autoApplyCampaign.update({
    where: { id: campaign.id },
    data: { isActive: !campaign.isActive },
  })

  revalidatePath('/dashboard')
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const userId = session.user.id

  const [resumes, campaigns, recentApplications, replyCount, telegramChat] = await Promise.all([
    prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.autoApplyCampaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { resume: { select: { title: true } } },
    }),
    prisma.jobApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { resume: { select: { title: true } } },
    }),
    prisma.inboxMessage.count({ where: { userId } }),
    prisma.telegramChat.findUnique({ where: { userId }, select: { chatId: true } }),
  ])

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const totalApps = await prisma.jobApplication.count({ where: { userId } })
  const weekApps = await prisma.jobApplication.count({
    where: { userId, createdAt: { gte: weekAgo } },
  })
  const interviews = await prisma.jobApplication.count({
    where: { userId, status: 'INTERVIEW' },
  })

  // Honest per-stage status: which recent applications have a CONFIRMED signal
  // (an ATS confirmation email matched to the application).
  const recentIds = recentApplications.map((a) => a.id)
  const confirmedEvents = recentIds.length
    ? await prisma.applicationEvent.findMany({
        where: { applicationId: { in: recentIds }, type: 'confirmed' },
        select: { applicationId: true },
      })
    : []
  const confirmedSet = new Set(confirmedEvents.map((e) => e.applicationId))
  const hasLinkedIn = recentApplications.some((a) => a.source === 'LINKEDIN')

  const plan = getPlanByPriceId(session.user.stripePriceId)

  return (
    <div className="container mx-auto max-w-6xl py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500">Welcome back, {session.user.name ?? session.user.email}!</p>
      </div>

      {/* Telegram onboarding gap: without a linked chat, notifications are
          silently dropped by the notifier. Make that explicit + actionable. */}
      {!telegramChat && (
        <div className="mb-8 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-900">
              🔔 Telegram isn&apos;t linked — you&apos;re missing application updates
            </p>
            <p className="text-xs text-amber-700">
              Submissions, recruiter replies, and interview requests are sent to Telegram.
              Until you link it, those notifications aren&apos;t delivered anywhere.
            </p>
          </div>
          <Link href="/dashboard/settings/notifications">
            <Button size="sm" className="whitespace-nowrap">Link Telegram</Button>
          </Link>
        </div>
      )}

      {/* Chrome extension install CTA — shown only once the extension is published
          and NEXT_PUBLIC_CHROME_EXTENSION_URL is set (no dead link before then). */}
      {process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL && (
        <div className="mb-8 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-emerald-900">
            🧩 Autofill any application in one click — get the ResumeAI Chrome extension.
          </p>
          <a href={process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="whitespace-nowrap">Install extension</Button>
          </a>
        </div>
      )}

      {/* KPI strip */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total Applications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalApps}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{weekApps}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Interviews</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{interviews}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Recruiter Replies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{replyCount}</div>
            <Link href="/dashboard/inbox" className="text-xs text-emerald-600 hover:underline">
              Open inbox →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Current Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{plan.name}</div>
            <p className="text-xs text-slate-400">{plan.dailyLimit} apps/day</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Resumes */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Your Resumes</h2>
            <Button asChild size="sm">
              <Link href="/dashboard/resumes/new">+ New resume</Link>
            </Button>
          </div>
          {resumes.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-slate-400">
                No resumes yet.{' '}
                <Link href="/dashboard/resumes/new" className="text-emerald-600 underline">
                  Create your first one
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {resumes.map((resume) => (
                <Card key={resume.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-slate-900">{resume.title}</p>
                      {resume.targetRole && (
                        <p className="text-sm text-slate-400">{resume.targetRole}</p>
                      )}
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/dashboard/resumes/${resume.id}`}>View</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Campaigns */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Active Campaigns</h2>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/campaigns/new">+ New campaign</Link>
            </Button>
          </div>
          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-slate-400">
                No campaigns yet.{' '}
                <Link href="/dashboard/campaigns/new" className="text-emerald-600 underline">
                  Start auto-applying
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {campaigns.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-slate-900">{c.name}</p>
                      <p className="text-sm text-slate-400">
                        {c.resume.title} &middot; {c.source}
                      </p>
                    </div>
                    <CampaignToggleForm id={c.id} isActive={c.isActive} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent applications */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Recent Applications</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/applications">View all</Link>
          </Button>
        </div>
        {recentApplications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              {campaigns.length === 0 ? (
                <>
                  <p className="text-slate-600">No applications yet — you don&apos;t have a campaign running.</p>
                  <Button asChild size="sm">
                    <Link href="/dashboard/campaigns/new">Create your first campaign</Link>
                  </Button>
                  <p className="max-w-md text-xs text-slate-400">
                    Pick keywords + locations and we auto-apply to matching jobs. Applications
                    show up here as <strong>queued → submitted → confirmed</strong>.
                  </p>
                </>
              ) : (
                <p className="max-w-md text-slate-500">
                  Your campaign is active. New applications appear here after the next
                  run (within ~30&nbsp;minutes), with honest per-stage status.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Job</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Company</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Source</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Fit</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentApplications.map((app) => (
                      <tr
                        key={app.id}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{app.jobTitle}</td>
                        <td className="px-4 py-3 text-slate-600">{app.company}</td>
                        <td className="px-4 py-3 text-slate-400">{app.source}</td>
                        <td className="px-4 py-3">
                          {app.fitScore != null ? (
                            <span
                              title={app.fitReasons.join(' • ')}
                              className={
                                app.fitScore >= 70
                                  ? 'font-medium text-emerald-600'
                                  : app.fitScore >= 45
                                    ? 'font-medium text-amber-600'
                                    : 'font-medium text-slate-400'
                              }
                            >
                              {app.fitScore}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge status={app.status} />
                            {confirmedSet.has(app.id) && (
                              <span className="text-xs text-emerald-600" title="The employer's ATS sent a confirmation email for this application">
                                ✓ confirmed by employer
                              </span>
                            )}
                            {app.source === 'LINKEDIN' && (
                              <span className="text-xs text-amber-600" title="LinkedIn replies arrive in your LinkedIn inbox, not here">
                                replies in LinkedIn ↗
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {app.appliedAt
                            ? new Date(app.appliedAt).toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
        {hasLinkedIn && (
          <p className="mt-3 text-xs text-slate-400">
            ↗ Replies to <strong>LinkedIn</strong> Easy Apply jobs land in your LinkedIn
            inbox and can&apos;t be tracked here — only email-based applications show
            confirmed/reply status.
          </p>
        )}
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    QUEUED: 'bg-slate-100 text-slate-600',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    FAILED: 'bg-red-100 text-red-700',
    INTERVIEW: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-orange-100 text-orange-700',
    OFFER: 'bg-green-100 text-green-700',
    WITHDRAWN: 'bg-slate-100 text-slate-400',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  )
}

function CampaignToggleForm({ id, isActive }: { id: string; isActive: boolean }) {
  return (
    <form action={toggleCampaign.bind(null, id)}>
      <Button type="submit" variant={isActive ? 'default' : 'outline'} size="sm">
        {isActive ? 'Pause' : 'Resume'}
      </Button>
    </form>
  )
}
