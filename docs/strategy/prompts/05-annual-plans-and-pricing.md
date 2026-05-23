# Prompt 05 — Annual plans + pricing page polish

> **Paste into Claude Code. Touches Stripe (LIVE MODE — extra care), pricing page, billing UI. Single-PR change.**
>
> ⚠️ **READ FIRST: `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.4.** `lib/pricing.ts` is an array `as const` with flat fields (`price`, `period`, `dailyLimit`, `priceId`) — NOT a `Record<string, …>` with nested monthly/yearly objects. Use the array-shape rewrite from the corrections doc, which adds yearly plans as separate entries and keeps every existing helper backward-compatible.
>
> ⚠️ **Webhook path correction:** the Stripe webhook lives at `app/api/webhooks/stripe/route.ts`, not `app/api/stripe/webhook/route.ts`. Apply this correction everywhere this prompt references it.
>
> 🚨 **VPS hard-fail:** end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why
You currently have monthly-only on Pro and Unlimited. Sonara prices annual at ~75% off monthly. Most SaaS prices annual at 17–20% off monthly. Adding annual:
- Lifts ARPU (annual customers pay 12 months upfront)
- Cuts effective churn to near zero for 12 months
- Improves cash-on-hand for ad spend
- Signals legitimacy alongside the 30-day money-back guarantee

Recommended: **Pro $199/yr (17% off vs $19.99×12 = $239.88)**, **Unlimited $299/yr (17% off vs $29.99×12 = $359.88)**.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §4.4 — pricing comparison table
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.4 — use this rewrite of `lib/pricing.ts`, NOT the one inline below
3. `lib/pricing.ts` — current array-`as const` shape
4. `app/pricing/page.tsx` — current pricing UI
5. `components/pricing-cards.tsx` — card component
6. `app/api/stripe/checkout/route.ts` — checkout session creation
7. `lib/stripe.ts` — Stripe client + retry config
8. `app/api/webhooks/stripe/route.ts` — webhook handler (note path)

## Changes

### Change 1 — Create Stripe prices (manual + scripted)

**You do this manually in the Stripe dashboard FIRST:**
- Open Stripe dashboard → Products → Pro plan → Add a price → Yearly, $199.00, recurring
- Open Stripe dashboard → Products → Unlimited plan → Add a price → Yearly, $299.00, recurring
- Copy the new `price_xxxx` IDs
- Add to `.env` on VPS:
  ```
  STRIPE_PRICE_ID_PRO_YEARLY=price_xxxx
  STRIPE_PRICE_ID_UNLIMITED_YEARLY=price_xxxx
  ```
- Add to `.env.example` (without values, just the keys)

**Important:** Both monthly and yearly prices share the SAME Stripe Product. This way upgrades/downgrades/proration work natively.

### Change 2 — `lib/pricing.ts`

Restructure to support `interval`:

```typescript
export type BillingInterval = 'month' | 'year';

export type PricingPlan = {
  id: string;
  name: string;
  description: string;
  priceMonthly?: { amount: number; priceId: string };
  priceYearly?: { amount: number; priceId: string };
  appsPerDay: number | 'unlimited';
  resumes: number | 'unlimited';
  features: string[];
};

export const PRICING_PLANS: Record<string, PricingPlan> = {
  free: { /* ... unchanged ... */ },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'For active job seekers',
    priceMonthly: { amount: 19.99, priceId: process.env.STRIPE_PRICE_ID_PRO! },
    priceYearly: { amount: 199,   priceId: process.env.STRIPE_PRICE_ID_PRO_YEARLY! },
    appsPerDay: 25,
    resumes: 'unlimited',
    features: [
      '25 applications per day',
      'Unlimited resumes',
      'LinkedIn auto-apply',
      'All 5 PDF templates',
      'Priority support',
      '30-day money-back guarantee',
    ],
  },
  unlimited: {
    id: 'unlimited',
    name: 'Unlimited',
    description: 'For aggressive search',
    priceMonthly: { amount: 29.99, priceId: process.env.STRIPE_PRICE_ID_UNLIMITED! },
    priceYearly: { amount: 299,   priceId: process.env.STRIPE_PRICE_ID_UNLIMITED_YEARLY! },
    appsPerDay: 'unlimited',
    resumes: 'unlimited',
    features: [
      'Unlimited daily applications',
      'Unlimited resumes',
      'All Pro features',
      'API access',
      'Dedicated account manager',
      '30-day money-back guarantee',
    ],
  },
};

export function getPriceIdForPlan(planId: string, interval: BillingInterval): string {
  const plan = PRICING_PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  if (interval === 'year' && plan.priceYearly) return plan.priceYearly.priceId;
  if (interval === 'month' && plan.priceMonthly) return plan.priceMonthly.priceId;
  throw new Error(`Plan ${planId} does not support ${interval} interval`);
}

export function getMonthlyEquivalent(planId: string, interval: BillingInterval): number {
  const plan = PRICING_PLANS[planId];
  if (interval === 'year' && plan.priceYearly) return plan.priceYearly.amount / 12;
  return plan.priceMonthly?.amount ?? 0;
}
```

### Change 3 — Checkout route

In `app/api/stripe/checkout/route.ts`, read `interval` from the request body (`'month' | 'year'`, default `'month'`). Use `getPriceIdForPlan(planId, interval)`. Everything else stays the same.

### Change 4 — Pricing page UI

In `app/pricing/page.tsx` + `components/pricing-cards.tsx`:
- Add a toggle at top of page: "Monthly | Annual (save 17%)"
- When Annual is selected, display the annual price as a big number with the effective monthly price as smaller text: "$199/yr ($16.58/mo)"
- Always show the savings badge on annual ("Save $40/year")
- Always show "30-day money-back guarantee" — this is your competitive weapon, don't bury it

UI copy specifically to use:
- Toggle: `Monthly` | `Yearly · Save 17%`
- Below price on annual: `That's just $16.58/month, billed annually`
- Below CTA on every plan: `30-day money-back guarantee · cancel anytime`
- Above CTA on Pro: a small badge "Most Popular" (use shadcn Badge)

### Change 5 — Billing portal default

In `app/api/stripe/portal/route.ts`, ensure the Stripe portal config allows interval switching (monthly↔annual upgrade). This is set in the Stripe dashboard, not code — but verify by hitting the portal and confirming the option is exposed.

### Change 6 — Analytics

Emit `AnalyticsEvent` with `event = "pricing_interval_toggled"` when the user switches the toggle. Emit `event = "checkout_started"` with property `interval` on checkout. These are the foundation for the A/B tests in Prompt 08.

### Change 7 — Webhook safety check

In `app/api/stripe/webhook/route.ts`, confirm:
- `checkout.session.completed` handler doesn't assume monthly billing anywhere
- `customer.subscription.updated` correctly handles interval changes
- `invoice.paid` does not double-credit referral bonuses (matters in Prompt 07)

If any of these assume monthly, fix them. Test by manually creating an annual sub in Stripe TEST mode and replaying webhook events.

## Verification
1. In Stripe TEST mode: create the same two annual prices with test product IDs in a `.env.test`
2. Run end-to-end: visit `/pricing` → toggle Annual → checkout → complete with `4242 4242 4242 4242`
3. Verify subscription created in Stripe shows yearly interval
4. Verify user record in DB has correct plan + interval
5. Repeat for both Pro and Unlimited
6. Test upgrade flow: monthly → annual on the same plan, verify proration
7. Test downgrade flow: annual → monthly (should schedule for end of period, not immediate)

## Deploy
1. Branch `feat/annual-pricing`
2. Add `STRIPE_PRICE_ID_PRO_YEARLY` and `STRIPE_PRICE_ID_UNLIMITED_YEARLY` to GitHub Actions secrets (for CI builds) AND to VPS `/opt/resumeai/.env`
3. Merge → CI deploys → SSH to VPS → `docker-compose up -d web`
4. Smoke test from production with a real card on a yearly Pro plan (you'll refund yourself within 48h via the portal)
5. Verify webhook fires, DB updates, user gets correct entitlements

## Rules
- Do NOT remove monthly plans. Both must coexist.
- Do NOT change existing price IDs. New prices only.
- Do NOT enable annual in prod until the test-mode smoke pass is complete.
- 30-day money-back wording must be EVERYWHERE the price is shown.
- Commit message: `feat(billing): add annual plans + pricing page toggle + analytics events`

## Definition of done
- Both annual prices live in Stripe live mode
- Pricing page toggle works, both intervals checkout correctly
- DB stores `interval` field on subscription (if not already)
- Webhook handles annual subscriptions correctly
- 30-day money-back text visible on every plan card
- Analytics events firing
- VPS git HEAD matches GitHub main
- `docs/ARCHITECTURE.md` Billing section updated
