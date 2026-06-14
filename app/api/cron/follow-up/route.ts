/**
 * POST /api/cron/follow-up
 *
 * Daily no-response follow-up nudges. Finds applications submitted N+ days ago
 * with no reply and emails each user one honest nudge per application (deduped).
 * See lib/notifications/follow-up.ts.
 *
 * Query: ?dryRun=1 → compute and return counts WITHOUT sending or marking.
 * Auth:  Authorization: Bearer <CRON_SECRET>
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { runFollowUpNudges } from '@/lib/notifications/follow-up'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[follow-up] unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  try {
    const result = await runFollowUpNudges({ dryRun })
    console.log('[follow-up] done', result)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[follow-up] failed', err)
    return NextResponse.json({ ok: false, error: 'follow-up run failed' }, { status: 500 })
  }
}
