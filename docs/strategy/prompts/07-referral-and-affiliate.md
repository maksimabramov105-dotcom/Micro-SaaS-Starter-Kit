# Prompt 07 — Referral program + affiliate integration (Tolt)

> **Paste into Claude Code. Two related systems, one PR. Referral is built in-house; affiliate is integrated via Tolt.**
>
> ⚠️ **Webhook path correction:** the Stripe webhook lives at `app/api/webhooks/stripe/route.ts`, not `app/api/stripe/webhook/route.ts`. Apply this correction everywhere this prompt references the webhook route. See `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.5.
>
> 🚨 **VPS hard-fail:** end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why
Per `docs/strategy/STRATEGIC_ANALYSIS.md` §6.3 and §6.5:
- **Referral** is the highest-ROI growth lever at your stage. A double-sided "$20 credit / $20 credit" referral drives 15–30% of new SaaS signups at $0 marginal CAC.
- **Affiliate** is a different channel (third-party creators driving paying traffic for a recurring cut). Don't build it; integrate Tolt or Rewardful.

This prompt builds the referral system in-house and wires Tolt for affiliates.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §6.3 and §6.5 — why referral first, why Tolt for affiliate
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.5 — webhook path correction
3. `prisma/schema.prisma` — current `User`, `firstPaidAt`, `refundedAt` fields
4. `lib/auth.ts` — user session shape, signIn callback (where referral cookie is captured)
5. `app/api/webhooks/stripe/route.ts` — webhook handler where credits are applied (NOTE PATH)
6. `lib/stripe.ts` — for coupon creation
7. `lib/billing/` — existing directory, drop new referral code under `lib/referral/` to keep modules small

## Part A — Referral system

### Change 1 — Schema

Add to `prisma/schema.prisma`:
```prisma
model Referral {
  id              String   @id @default(cuid())
  referrerId      String
  referrer        User     @relation("ReferrerRelation", fields: [referrerId], references: [id], onDelete: Cascade)
  refereeId       String   @unique
  referee         User     @relation("RefereeRelation", fields: [refereeId], references: [id], onDelete: Cascade)
  status          String   @default("pending")  // pending | qualified | rewarded | abused
  stripeCouponReferrerId String?
  stripeCouponRefereeId  String?
  qualifiedAt     DateTime?
  rewardedAt      DateTime?
  createdAt       DateTime @default(now())

  @@index([referrerId])
  @@index([status])
}

model User {
  // ... existing
  referralCode    String?   @unique  // e.g. "adam-7g9k"
  referralCount   Int       @default(0)
  referralEarned  Float     @default(0)  // total $ credit earned, lifetime
  referredById    String?
  referredBy      User?     @relation("UserReferredBy", fields: [referredById], references: [id])
  referredUsers   User[]    @relation("UserReferredBy")
  referralsAsReferrer Referral[] @relation("ReferrerRelation")
  referralsAsReferee  Referral[] @relation("RefereeRelation")
}
```
Migration: `add_referral_system`.

### Change 2 — Generate referral codes

In `lib/referral.ts` (new):
```typescript
import { customAlphabet } from 'nanoid';
const codeGen = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 6); // no ambiguous chars

export async function ensureReferralCode(userId: string): Promise<string> {
  // get or create User.referralCode (lowercase username-friendly slug + 4-char nanoid)
}
```
Backfill: write a one-off `scripts/backfill_referral_codes.ts` that assigns codes to existing users.

### Change 3 — Capture referral on signup

Add `/r/{code}` Next.js route in `app/r/[code]/page.tsx`:
- Look up referrer by code
- Set a `referral_code` cookie (30 days, httpOnly false, sameSite=lax)
- Redirect to `/` (or `/signup`)

In NextAuth `signIn` callback in `lib/auth.ts`:
- On first signup, read the `referral_code` cookie
- If present and valid (not self-referral), create `Referral` row with `status='pending'` and set `User.referredById`

### Change 4 — Qualification trigger

In `app/api/stripe/webhook/route.ts`, on `invoice.paid` event where the user has `referredById` and there's a pending `Referral` row:
1. Mark `Referral.status = 'qualified'`, set `qualifiedAt`
2. Create a $20 one-time Stripe coupon for the **referrer** (`stripe.coupons.create({ amount_off: 2000, currency: 'usd', duration: 'once' })`)
3. Create a $20 coupon for the **referee** to apply on next invoice
4. Save coupon IDs on the `Referral` row
5. Apply referrer's coupon to their NEXT invoice via `stripe.customers.update({ coupon: ... })` OR `stripe.invoices.create({ ... })` — whichever fits your existing flow
6. Apply referee's coupon to their current/next invoice
7. Increment `User.referralCount`, add 20 to `User.referralEarned`
8. Mark `Referral.status = 'rewarded'`, set `rewardedAt`
9. Send email to referrer: "You earned $20! Keep sharing your link."

### Change 5 — Anti-abuse

- Cap: max 10 successful referrals per user (= $200/yr earnings). Document in T&C update.
- Reject if referrer's `User.id == referee's User.id` (same person can't self-refer)
- Reject if referee's email shares the same domain as referrer's AND is in a list of free-email providers (gmail, etc) — actually skip this, too lossy. Instead:
- Watch for `Referral.status = 'abused'` set manually when fraud detected — coupons not issued
- If a referee refunds within 30 days, claw back the referrer's credit (cancel coupon, decrement counters)

### Change 6 — Dashboard UI

New page `app/dashboard/referrals/page.tsx`:
- Big share link block: `https://resumeai-bot.ru/r/{code}` with copy-to-clipboard button
- Pre-written share text for Twitter/X, LinkedIn, email (one-click share buttons)
- Stats: `{X} referrals · ${Y} earned · ${Z} credit available`
- Recent referrals table: referee email (masked: `joh***@example.com`), date, status
- Cap progress bar: `7 / 10 referrals this year`

### Change 7 — Email triggers

In `lib/email/` add templates:
- `referral_qualified.tsx` — to referrer when a friend pays
- `referral_received.tsx` — to referee when they sign up via a referral ("Welcome! Your friend already gave you $20 credit on your first paid plan.")

### Change 8 — Tests
- Signup with `?ref=code` cookie → Referral row created with status pending
- Webhook on referee's first paid invoice → both coupons created, both rows updated
- Self-referral rejected
- Cap enforced at 10
- Refund within 30d → clawback works

## Part B — Affiliate (Tolt integration)

### Decision: use Tolt ($29/mo)
- Native Stripe integration (just paste Stripe API key in Tolt dashboard)
- Handles attribution via 30-day cookie + UTM tracking
- Handles payouts via PayPal/Wise
- 30% recurring commission is standard; ~7-day cookie window matches typical SaaS

### Change 9 — Tolt setup
1. Sign up at [Tolt.io](https://tolt.io), pick the $29/mo plan
2. Connect Stripe (give Tolt restricted API key with `read` on customers + subscriptions)
3. Create affiliate program: 30% recurring, 60-day cookie, $25 minimum payout
4. Get the Tolt tracking script

### Change 10 — Script injection

In `app/layout.tsx`:
```tsx
{process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID && (
  <Script
    src="https://cdn.tolt.io/tolt.js"
    data-tolt={process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID}
    strategy="afterInteractive"
  />
)}
```
Add `NEXT_PUBLIC_TOLT_REFERRAL_ID` to env.

### Change 11 — Stripe metadata bridge

In `app/api/stripe/checkout/route.ts`, when creating the checkout session, include `client_reference_id` set to the Tolt visitor ID (Tolt's script exposes `window.tolt.getReferral()`). Pass via a hidden form field on the pricing page. This lets Tolt attribute the conversion.

### Change 12 — Disclosure

Add to your `/terms` page: "We run an affiliate program via Tolt. Affiliates may earn commissions on paid subscriptions referred. This does not affect the price you pay."

## Verification
- Create test referral: friend signs up via your `/r/{code}` link, friend subscribes in Stripe test mode → confirm both coupons created, both credited
- Tolt: sign up as your own affiliate, get your test link, complete checkout, verify Tolt dashboard shows the conversion attributed

## Deploy
1. Branch `feat/referral-and-affiliate`
2. Stripe coupon creation IS a billable Stripe action — test in TEST mode first
3. Merge → CI deploys
4. Tolt setup is manual but cheap to test
5. Update `/terms` and `/privacy` with disclosure (bump `LAST_UPDATED`)

## Rules
- Single-user-can't-self-refer is the most-missed abuse vector — get it right
- Coupon creation must be idempotent (use the Referral row ID as `idempotency_key`)
- Tolt cookie window must match referral cookie window — pick 30 days for both
- Referral rewards are credits applied to future Stripe invoices, NOT cash payouts
- Affiliate (Tolt) IS cash, handled by Tolt — don't mix the two
- Commit message: `feat(growth): referral program + Tolt affiliate integration`

## Definition of done
- Referral end-to-end works in production
- Dashboard page live
- Email triggers firing
- Tolt connected, first test affiliate signup tracked
- T&C updated with affiliate disclosure
- `docs/ARCHITECTURE.md` updated with new Referral subsystem
- VPS git HEAD matches GitHub main
