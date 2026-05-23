# Real-repo audit + prompt corrections

**Date:** 2026-05-23
**Auditor:** Strategic review, second pass
**Inputs:** Real repo `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit` cloned at HEAD `52466f1`
**Companion files:** `STRATEGIC_ANALYSIS.md` + `prompts/00..08-*.md`

> **Note on the originally-mentioned `claude/*` worktree branches:** these turned out to be internal Claude Code agent bookkeeping branches that lived in an unrelated local repo. They are NOT feature work and require no action. Every concrete correction below is based on reading the real `Micro-SaaS-Starter-Kit/main` HEAD — those findings stand regardless.

Branches present on MSSK's `origin` at the time of audit:
```
bootstrap/v1-strip-down
chore/publish-architecture-docs-and-block-guard
feat/chrome-extension
feat/job-email-inbox
feat/money-back-guarantee-refund
feat/per-application-tailoring
feat/pmf-measurement
feat/telegram-notifications
fix/persistent-bugs-rename-oauth-404
main (HEAD = 52466f1)
rename/resumeai
security/initial-hardening
```

Several of these look stale — worth closing or merging during a hygiene pass when convenient.

---

## 2. Drift summary — by prompt

| Prompt | Severity | What was wrong |
|--------|----------|----------------|
| 02 (Resume quality) | **HIGH** | System prompts live in `.txt` files (`worker/worker/ai/prompts/`), not Python module constants. Big enough to break the prompt entirely if Claude Code follows my original text. |
| 03 (PDF templates) | MEDIUM | Existing PDF flow uses `resume_text` (a single string), not structured JSON. My template engine assumed structured data. Need a JSON shape adapter. |
| 04 (Stability) | MEDIUM | Webhook path is `app/api/webhooks/stripe/` not `app/api/stripe/webhook/`. `hh.ru` columns are also referenced by `scripts/migrate-from-legacy.ts` — dropping requires also patching that file. Worker `tailor.py` ALSO has an in-memory cache (same restart-loses-data problem as jobs.py). Web Sentry sample rates are too high (will burn through free tier). |
| 05 (Annual plans) | **HIGH** | `lib/pricing.ts` is an array `as const` with flat fields (`price`, `period`, `dailyLimit`, `priceId`). My prompt assumed `Record<string, …>` with nested `priceMonthly` / `priceYearly`. Type rewrite would be wrong shape. |
| 07 (Referral / affiliate) | LOW | Webhook path same correction as prompt 04. Otherwise clean. |
| 08 (Flags / A-B) | LOW | `lib/analytics.ts` and `lib/analytics-advanced.ts` already exist. Don't create new ones; extend. |
| 01 (Audit), 06 (2FA) | NONE | Both still accurate as written. |

Three other reality checks (NOT drift in my prompts but worth knowing):

1. **The system has moved significantly past your context.** Recent commits added a Greenhouse scraper, a campaign runner that actually submits via Playwright, OOM protections, and an inbox-email feature. ARCHITECTURE.md hasn't caught up.
2. **`MAX_APPLIES_PER_RUN = 3`** per cron run × 12 cron triggers per day = **36 Playwright apps/day max across all users** — this is a hard ceiling that conflicts with Pro's marketed "25/day" and Unlimited's "unlimited". You will hit user complaints at scale. Either bump the cron frequency, parallelize runs, or adjust the marketing copy.
3. **FAQ promises a "14-day free trial"** (`app/faq/page.tsx`) but no trial plan exists in `lib/pricing.ts`. The worker has trial-tier logic (`should_tailor`) but it's never reached because there's no path to becoming a trial user. This is a soft promise that doesn't ship — fix or remove.

---

## 3. Corrections — apply IN ADDITION to the original prompts

When Claude Code runs each prompt, point it at this section first so it knows what to override.

### 3.1 Corrections to Prompt 02 (Resume quality upgrade)

**Replace** the "Change 1" instruction with this:

> The system prompts are NOT Python module constants. They live in external text files:
> - `worker/worker/ai/prompts/resume.txt`
> - `worker/worker/ai/prompts/cover_letter.txt`
> - `worker/worker/ai/prompts/tailor_resume.txt`
> - `worker/worker/ai/prompts/tailor_cover_letter.txt`
>
> Loaded once at module import via `(_PROMPTS_DIR / "resume.txt").read_text(encoding="utf-8").strip()`.
>
> For V2: create new files **alongside** the existing ones, with a `_v2` suffix:
> - `resume_v2.txt`, `tailor_resume_v2.txt`, `tailor_cover_letter_v2.txt`
>
> In `worker/worker/ai/resume.py` and `tailor.py`, load BOTH versions at import:
> ```python
> _RESUME_SYSTEM_PROMPT_V1 = (_PROMPTS_DIR / "resume.txt").read_text(...).strip()
> _RESUME_SYSTEM_PROMPT_V2 = (_PROMPTS_DIR / "resume_v2.txt").read_text(...).strip()
> ```
> Then in the call site, branch on `settings.resume_quality_v2`. The V2 file content is exactly the STAR/CAR constraint prompt from the original prompt — just save it as a `.txt` instead of a Python string.

**Add a note for the keywords + critique modules:**

> `worker/worker/ai/` does NOT have a `client.py`. Reuse the `_call_openai` function that already lives in `worker/worker/ai/resume.py` (it's imported by tailor.py — same pattern works for keywords.py and critique.py).

**Replace Change 4 (feature flag in worker config.py)** — that part stays correct. `worker/worker/config.py` uses `pydantic_settings.BaseSettings` and the new field would look like:
```python
resume_quality_v2: bool = False
```

**Add to Change 6 (tracking):** The web-side trigger isn't `app/api/resumes/[id]/generate/route.ts`. Resume tailoring happens inside the campaign runner at `app/api/cron/run-campaigns/route.ts` (calls `tailor_resume` via the worker). Emit the AnalyticsEvent there.

### 3.2 Corrections to Prompt 03 (PDF templates)

**Add a Change 3.5 — data shape adapter:**

> The existing PDF endpoint at `app/api/resumes/[id]/pdf/route.ts` reads `resume.generated.resume_text` (a single string) and sends it to the worker as `{ resume_text, title }`. The worker route is `POST /jobs/resume/pdf`.
>
> Templates need STRUCTURED data, not a single string. Build an adapter:
> 1. Prefer `resume.generated.resume_structured` if present (a JSON tree matching the schema from Prompt 02's V2 output)
> 2. Else parse `resume.generated.resume_text` via a best-effort line-splitter into a degraded structure (Summary + Experience + Education + Skills sections)
> 3. Pass the structured object to the new `POST /resumes/{resume_id}/render` worker endpoint
>
> Keep the legacy `POST /jobs/resume/pdf` route untouched for fallback. The new picker UI uses the new endpoint; legacy download buttons keep using the old one until the feature flag is fully rolled out.

**Correct the route path reference:** the existing PDF route is `app/api/resumes/[id]/pdf/route.ts`. My original prompt got that right — no change.

**Note on web Sentry config:** `sentry.client.config.ts` currently sets `tracesSampleRate: 1.0` and `replaysOnErrorSampleRate: 1.0`. At any real traffic these will blow through the Sentry free tier. Lower to `tracesSampleRate: 0.1` and `replaysOnErrorSampleRate: 0.3` before promoting the site. This is small but should ship with Prompt 04 fix 1.

### 3.3 Corrections to Prompt 04 (Stability hardening)

**Fix 1 (Sentry) — refinements:**
- Web Sentry IS already wired (`sentry.client.config.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts` all exist). DSN is read from `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` — both already in `.env.example`. **Only thing missing on web side is lowering the sample rates** (see §3.2 above).
- Worker: still completely unwired. Add as originally specced.
- Notifier: still completely unwired. Add as originally specced.

**Fix 2 (Redis job store) — broader scope:**
- The same restart-loses-data problem exists in **`worker/worker/ai/tailor.py`** which has its own in-process `_CACHE: dict` for tailored resumes (lines ~50). Add the same Redis-backed treatment.
- Redis service is already in `docker-compose.yml`. Confirmed. Use DB 2 for tailor cache (DB 0 = notifier, DB 1 = jobs from Prompt 04, DB 2 = tailor cache).
- `worker/worker/config.py` already has `redis_url: str = ""`. Default in `docker-compose.yml`.

**Fix 3 (hh.ru cleanup) — needs ALSO:**
- `scripts/migrate-from-legacy.ts` at lines 500-501 still references `hhToken` and `hhResumeId`. Migration must EITHER:
  - (preferred) delete `scripts/migrate-from-legacy.ts` entirely — the legacy migration has long since been run and this script is dead weight, OR
  - patch the script to omit those fields and add a comment noting why
- Run `grep -rn "hh" prisma/ scripts/ lib/ app/ worker/` one more time AFTER schema edit to confirm zero refs remain.

**Fix 4 (Legal dates) — unchanged, but add:**
- Also update `app/faq/page.tsx`. It claims "14-day free trial" which doesn't exist. Either remove the claim or implement the trial (see fix 5).

**Fix 5 (STRIPE_PRICE_ID_TRIAL) — reality is different from your original context:**
- `STRIPE_PRICE_ID_TRIAL` is NOT in `.env.example` (you may have it on the VPS only)
- The FAQ page explicitly promises a 14-day trial
- The worker code (`worker/worker/ai/tailor.py` `should_tailor`) has trial-tier branching logic
- `lib/pricing.ts` has no trial entry
- Decision tree:
  1. If you want to ship the trial: add to pricing.ts as `{id: 'trial', period: '14day_trial', priceId: process.env.STRIPE_PRICE_ID_TRIAL || null, ...}`, wire the checkout, wire the auto-conversion-to-Pro after 14 days
  2. If you don't: remove the FAQ claim, leave the worker logic (it's harmless), remove the env var if it exists in prod
- **Also orphan:** `STRIPE_PRICE_ID_BASIC` and `STRIPE_PRICE_ID_ENTERPRISE` are in `.env.example` but not in `PRICING_PLANS`. Either add the plans or remove the vars.

**Webhook path correction across the whole prompt:**
- Wrong (mine): `app/api/stripe/webhook/route.ts`
- Right: **`app/api/webhooks/stripe/route.ts`**
- This affects every mention of the webhook route in Prompts 04, 05, 07.

### 3.4 Corrections to Prompt 05 (Annual plans + pricing)

**Replace the entire `lib/pricing.ts` rewrite with this — matches the existing array-`as const` shape:**

```typescript
export const PRICING_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: null,
    dailyLimit: 3,
    priceId: null,
    intervalKey: null,
    features: ['3 applications/day', '1 resume', 'Adzuna + RemoteOK jobs'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19.99,
    period: 'month',
    dailyLimit: 25,
    priceId: process.env.STRIPE_PRICE_ID_PRO || null,
    intervalKey: 'month',
    features: [
      '25 applications/day',
      'Unlimited resumes',
      'LinkedIn autoapply',
      'Priority support',
      '30-day money-back guarantee',
    ],
  },
  {
    id: 'pro_yearly',
    name: 'Pro (Yearly)',
    price: 199,
    period: 'year',
    dailyLimit: 25,
    priceId: process.env.STRIPE_PRICE_ID_PRO_YEARLY || null,
    intervalKey: 'year',
    features: [
      'Everything in Pro',
      'Save $40/year vs monthly',
      'Locked-in price for 12 months',
    ],
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: 29.99,
    period: 'month',
    dailyLimit: 9999,
    priceId: process.env.STRIPE_PRICE_ID_UNLIMITED || null,
    intervalKey: 'month',
    features: [
      'Unlimited applications',
      'Unlimited resumes',
      'All platforms',
      'API access',
      '30-day money-back guarantee',
    ],
  },
  {
    id: 'unlimited_yearly',
    name: 'Unlimited (Yearly)',
    price: 299,
    period: 'year',
    dailyLimit: 9999,
    priceId: process.env.STRIPE_PRICE_ID_UNLIMITED_YEARLY || null,
    intervalKey: 'year',
    features: [
      'Everything in Unlimited',
      'Save $60/year vs monthly',
      'Locked-in price for 12 months',
    ],
  },
] as const

export type PricingPlan = (typeof PRICING_PLANS)[number]
export type BillingInterval = 'month' | 'year'

export function getPlanByPriceId(priceId: string | null | undefined): PricingPlan {
  return PRICING_PLANS.find((p) => p.priceId === priceId) ?? PRICING_PLANS[0]
}

export function getPlanById(id: string): PricingPlan {
  return PRICING_PLANS.find((p) => p.id === id) ?? PRICING_PLANS[0]
}

export function getPlanForCheckout(family: 'pro' | 'unlimited', interval: BillingInterval): PricingPlan | undefined {
  const id = interval === 'year' ? `${family}_yearly` : family
  return PRICING_PLANS.find((p) => p.id === id)
}

export function getMonthlyEquivalent(plan: PricingPlan): number {
  if (plan.period === 'year') return plan.price / 12
  return plan.price
}
```

**Why this shape:** preserves the existing `as const` semantics (downstream code reads `PRICING_PLANS[0].id` etc as literals), keeps all existing helpers (`getPlanById`, `getPlanByPriceId`) working unchanged, and adds new helpers without removing anything. Existing checkout code paths keep working.

**Pricing page UI:** the toggle should filter plans by `period`. When "Monthly" is selected, show `pro` and `unlimited`. When "Yearly" is selected, show `pro_yearly` and `unlimited_yearly`. No changes to the card component shape needed.

**Webhook path correction:** same as §3.3 — `app/api/webhooks/stripe/route.ts`.

### 3.5 Corrections to Prompt 07 (Referral + affiliate)

- Webhook path correction same as §3.3
- The reference to `app/api/stripe/webhook/route.ts` in Change 4 should be `app/api/webhooks/stripe/route.ts`
- Confirmed `User` model has `firstPaidAt` and `refundedAt` — referral qualification on `invoice.paid` AND clawback on `charge.refunded` both have data to work with
- `lib/billing/` already exists — drop the new referral coupon code under `lib/referral/` to keep modules small

### 3.6 Corrections to Prompt 08 (Flags + A/B)

- `lib/analytics.ts` AND `lib/analytics-advanced.ts` already exist. Don't create a new `lib/analytics.ts` — add a `lib/experiments.ts` and integrate. Existing analytics calls already write to `AnalyticsEvent` model.
- The Prisma model `AnalyticsEvent` already exists (confirmed in `prisma/schema.prisma`) — use it as-is for experiment conversion tracking; just include `experiment_key` and `variant` in the `properties` JSON field.

---

## 4. Items that are now also worth tackling (not in original prompts)

These came out of the real audit, not the original brief. Optional but high-leverage:

### 4.1 Architecture doc rewrite
The doc only describes Google OAuth (GitHub and Email work too — confirmed in env). It doesn't mention: Chrome extension, Greenhouse scraper, campaign runner cron, OpenRouter proxy, PDF endpoint, OOM protections, Playwright integration, inbox-email feature, or the trial concept. Right after Prompt 01 runs (audit), update ARCHITECTURE.md so the next 3 months of work has a real map.

### 4.2 Campaign capacity ceiling
`MAX_APPLIES_PER_RUN = 3` × 12 cron runs/day = 36 Playwright apps/day TOTAL across ALL users. The Pro tier promises 25/day per user; Unlimited promises unlimited. Three real users on Unlimited and you're overcapacity. Options:
- Parallelize the cron runs (multiple GitHub Actions workflows on staggered schedules)
- Run the cron more often (every 30min instead of every 2h → 144 apps/day)
- Pre-cache job fetches separately from the apply step
- Cap each user explicitly and gracefully — show "X/25 applications used today, next batch at HH:MM"
- This needs its own prompt: `09-campaign-capacity.md` (suggested)

### 4.3 Sentry sample rates for web
Drop `tracesSampleRate` from 1.0 to 0.1 and `replaysOnErrorSampleRate` from 1.0 to 0.3 in `sentry.client.config.ts`. At your traffic level today this is fine; once you do paid acquisition, 1.0 will exhaust your free Sentry quota inside a week.

### 4.4 `STRIPE_PRICE_ID_BASIC` and `STRIPE_PRICE_ID_ENTERPRISE` cleanup
Orphan env vars. Either implement the plans or strike from `.env.example`. Trivial cleanup, removes confusion for any future contractor.

### 4.5 Existing GitHub PRs to look at
Open PRs: #1, #2, #3, #4 (merged?), #5, #6, #7, #8. Before running my prompts, you should review/merge/close these to keep `main` clean. Several look stale.

---

## 5. Updated execution order

Apply the corrections above when running each prompt. New recommended order:

1. **Prompt 01** (audit, read-only) — unchanged
2. **Prompt 04 (corrected)** — Sentry on worker + notifier, Redis-backed job store AND tailor cache, hh.ru cleanup including `scripts/migrate-from-legacy.ts`, legal dates + FAQ trial claim, trial plan decision, BASIC/ENTERPRISE env cleanup, web Sentry sample rate fix
3. **Architecture doc rewrite** (new step) — bring docs up to current reality so prompts 02/03/05 have a stable map
4. **Prompt 02 (corrected)** — V2 prompts as `.txt` files, not Python constants
5. **Prompt 03 (corrected)** — with JSON adapter
6. **Prompt 05 (corrected)** — pricing.ts as array-`as const`, both yearly plans as separate array entries
7. **Prompt 08 (corrected)** — extend existing analytics
8. **Prompt 07 (corrected)** — referral + Tolt
9. **Campaign capacity** (new prompt 09 — write when reaching ~30 paying customers)
10. **Prompt 06** — 2FA, deferred

---

## 6. What I did NOT change

Original prompts 01, 06 were correct and need no edits. The strategic analysis (`STRATEGIC_ANALYSIS.md`) is still accurate — competition data, feature decisions, $10K roadmap, channel mix, all hold.
