import Link from 'next/link'
import { PRICE } from '@/lib/pricing'

/**
 * components/quota-banner.tsx — the upgrade prompt at the quota edge (P4.4).
 *
 * Shown on the dashboard, and only when it is actually informative. Three
 * states, because a banner that is always there is wallpaper:
 *
 *   - plenty left  -> render nothing at all
 *   - nearly out   -> quiet notice, no hard sell
 *   - at the limit -> the upgrade CTA, because this is the exact moment the
 *                     value of Pro is concrete rather than hypothetical
 *
 * Paying users never see it: they are not the audience for an upgrade prompt,
 * and showing them one is how you make a paid product feel cheap.
 *
 * The `ref` tag on the link is what makes P4.4's "track conversion per prompt"
 * work — /pricing already records checkout_started with the referrer, so the
 * daily pulse can attribute upgrades to this specific surface rather than
 * guessing.
 *
 * Server component, zero client JS.
 */
export function QuotaBanner({
  usedToday,
  dailyLimit,
  isPaid,
}: {
  usedToday: number
  dailyLimit: number
  isPaid: boolean
}) {
  if (isPaid) return null

  const remaining = Math.max(0, dailyLimit - usedToday)
  // Only speak up in the last third of the allowance.
  if (remaining > Math.max(1, Math.floor(dailyLimit / 3))) return null

  const atLimit = remaining === 0

  return (
    <div
      className={`rounded-lg border p-4 ${
        atLimit ? 'border-emerald-300 bg-emerald-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            {atLimit
              ? `You've used all ${dailyLimit} applications for today`
              : `${remaining} application${remaining === 1 ? '' : 's'} left today`}
          </p>
          <p className="mt-0.5 text-sm text-slate-700">
            {atLimit
              ? `Your allowance resets tomorrow. Pro raises it to 25 a day, with unlimited tailoring and every PDF template.`
              : `The free plan includes ${dailyLimit} a day. Pro raises it to 25.`}
          </p>
        </div>
        {atLimit && (
          <Link
            href="/pricing?ref=quota-limit"
            className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Upgrade to Pro — {PRICE.proMonthly}/mo
          </Link>
        )}
      </div>
      {atLimit && (
        <p className="mt-2 text-xs text-slate-500">
          30-day money-back guarantee. Cancel any time.
        </p>
      )}
    </div>
  )
}
