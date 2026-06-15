/**
 * POST /api/cron/win-back
 *
 * Daily win-back re-engagement. Finds users whose scheduled win-back date has
 * arrived (set on cancel = cancel + WIN_BACK_DELAY_DAYS) and who have not
 * resubscribed, and emails each one once. See lib/notifications/win-back.ts.
 *
 * Query: ?dryRun=1 → compute and return counts WITHOUT sending or marking.
 * Auth:  Authorization: Bearer <CRON_SECRET>
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { runWinBack } from '@/lib/notifications/win-back'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[win-back] unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  try {
    const result = await runWinBack({ dryRun })
    console.log('[win-back] done', result)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[win-back] failed', err)
    return NextResponse.json({ ok: false, error: 'win-back run failed' }, { status: 500 })
  }
}
