/**
 * /dashboard/referrals
 *
 * Referral program dashboard.
 * Shows the user's unique share link, stats, and recent referral history.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getReferralStats, MAX_REFERRALS, REFERRAL_FREE_MONTHS, PRO_MONTHLY_VALUE_USD } from '@/lib/referral'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyLinkButton } from './copy-link-button'

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:  { label: 'Pending',   variant: 'secondary' },
  qualified:{ label: 'Qualified', variant: 'outline' },
  rewarded: { label: 'Rewarded',  variant: 'default' },
  abused:   { label: 'Flagged',   variant: 'destructive' },
  clawback: { label: 'Refunded',  variant: 'destructive' },
}

export default async function ReferralsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const stats = await getReferralStats(session.user.id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://resumeai-bot.ru'
  const shareUrl = `${appUrl}/r/${stats.code}`
  const monthLabel = REFERRAL_FREE_MONTHS === 1 ? '1 free month' : `${REFERRAL_FREE_MONTHS} free months`

  // Pre-written share copy
  const twitterText = encodeURIComponent(
    `I use ${process.env.NEXT_PUBLIC_APP_NAME ?? 'ResumeAI'} to automate my job applications with AI. Try it free with my link: ${shareUrl}`,
  )
  const linkedinText = encodeURIComponent(shareUrl)

  return (
    <div className="container mx-auto max-w-3xl py-8 px-4 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Referral Program</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Share your link — when a friend gets a <strong>year of Pro</strong>, you get <strong>{monthLabel} of Pro</strong>, free.
          Earn up to <strong>{MAX_REFERRALS} free months</strong>.
        </p>
      </div>

      {/* Share link */}
      <Card>
        <CardHeader>
          <CardTitle>Your referral link</CardTitle>
          <CardDescription>Share it anywhere — your free month is applied automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyLinkButton url={shareUrl} />

          {/* One-click share buttons */}
          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href={`https://twitter.com/intent/tweet?text=${twitterText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Share on X / Twitter
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${linkedinText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Share on LinkedIn
            </a>
            <a
              href={`mailto:?subject=Try ${process.env.NEXT_PUBLIC_APP_NAME ?? 'ResumeAI'} for your job search&body=Hey!%0A%0AI've been using ${process.env.NEXT_PUBLIC_APP_NAME ?? 'ResumeAI'} to automate my job search. Sign up with my link:%0A${encodeURIComponent(shareUrl)}`}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Send via email
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{stats.referralCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Referrals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{Math.round(stats.referralEarned / PRO_MONTHLY_VALUE_USD)}</p>
            <p className="text-xs text-muted-foreground mt-1">Free months earned</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{MAX_REFERRALS - stats.referralCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Remaining slots</p>
          </CardContent>
        </Card>
      </div>

      {/* Cap progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Cap progress</span>
          <span>{stats.referralCount} / {MAX_REFERRALS} referrals</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${Math.min(100, (stats.referralCount / MAX_REFERRALS) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Max {MAX_REFERRALS} rewarded referrals per account (up to {MAX_REFERRALS} free months of Pro).
          See our <a href="/terms" className="underline underline-offset-2">terms</a>.
        </p>
      </div>

      {/* Recent referrals table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent referrals</CardTitle>
          <CardDescription>Last 10 signups via your link.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentReferrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No referrals yet. Share your link above to get started!
            </p>
          ) : (
            <div className="divide-y">
              {stats.recentReferrals.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-mono">{r.refereeMasked}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </p>
                  </div>
                  <Badge variant={STATUS_LABEL[r.status]?.variant ?? 'secondary'}>
                    {STATUS_LABEL[r.status]?.label ?? r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
