# Architecture

High-level map of the system's major subsystems and how they relate.

---

## Technology stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | PostgreSQL via Prisma ORM |
| Auth | NextAuth.js v4 (JWT strategy) |
| Payments | Stripe (subscriptions + webhooks) |
| Email | Resend (via `lib/email.ts`) |
| Background jobs | GitHub Actions (cron → HTTP) |
| Notifications | Telegram Bot (outbound-only, Redis pub/sub) |
| Hosting | Docker on VPS (`resumeai-bot.ru`) |

---

## Subsystem overview

### Auth (`lib/auth.ts`)

NextAuth.js with the JWT session strategy. Provider: Google OAuth. The session callback enriches the JWT with Stripe billing fields (`stripeSubscriptionId`, `stripePriceId`, `stripeCurrentPeriodEnd`), PMF tracking fields (`firstPaidAt`, `refundedAt`), and the user role.

Session fields are declared in `types/next-auth.d.ts` and sourced from the `User` Prisma table.

---

### Billing (`lib/billing/`, `app/api/stripe/`, `app/api/billing/`)

| File | Responsibility |
|---|---|
| `app/api/stripe/create-checkout-session/route.ts` | Create Stripe Checkout session — accepts `{ planId, interval }` (never raw price IDs from client) |
| `app/api/stripe/cancel/route.ts` | Cancel subscription + capture exit reason |
| `app/api/billing/refund/route.ts` | 30-day money-back refund (one per customer) |
| `app/api/webhooks/stripe/route.ts` | Receive Stripe events; update DB state (interval-agnostic via `getPlanByPriceId`) |
| `lib/billing/refund.ts` | Pure eligibility checker (`checkRefundEligibility`) |
| `lib/billing/email-refund-confirmation.ts` | Refund confirmation email helper |
| `lib/pricing.ts` | Single source of truth for all plan definitions (monthly + annual) |

**Plans** (defined in `lib/pricing.ts`):

| ID | Price | Interval | Stripe env var |
|---|---|---|---|
| `free` | $0 | — | — |
| `pro` | $19.99/mo | monthly | `STRIPE_PRICE_ID_PRO` |
| `pro_yearly` | $199/yr | annual | `STRIPE_PRICE_ID_PRO_YEARLY` |
| `unlimited` | $29.99/mo | monthly | `STRIPE_PRICE_ID_UNLIMITED` |
| `unlimited_yearly` | $299/yr | annual | `STRIPE_PRICE_ID_UNLIMITED_YEARLY` |

Webhook events handled: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`. The webhook is **interval-agnostic** — `getPlanByPriceId` resolves both monthly and yearly price IDs automatically.

Key DB fields on `User`: `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `stripeCurrentPeriodEnd`, `firstPaidAt`, `cancelledAt`, `refundedAt`.

---

### Feature Flags + A/B Experiments (`lib/flags.ts`, `lib/experiments.ts`, `middleware.ts`)

Stage 1 in-house implementation (zero external deps). Migrate to PostHog free tier at $5K MRR.

| File | Responsibility |
|---|---|
| `lib/flags.ts` | DB-backed flag evaluation; 5-min in-memory cache; `isFlagEnabled(key, userId)` |
| `lib/experiments.ts` | Variant assignment (DB-sticky, deterministic SHA-256 bucket); `getOrAssignVariant(key, userId)` |
| `middleware.ts` | Edge middleware: seeds `rai_anon` cookie for anonymous visitors |
| `prisma/seed-experiments.ts` | Idempotent upsert of initial flags + 3 starter experiments |
| `scripts/experiment_results.ts` | CLI: per-variant conversion counts + two-proportion Z-test p-value |
| `app/dashboard/admin/flags/page.tsx` | Admin UI: flag toggles, rollout % sliders, experiment assignment counts |

**Prisma models:** `FeatureFlag`, `Experiment`, `ExperimentAssignment`

**Experiments seeded:**

| Key | Variants | Description |
|---|---|---|
| `pricing_headline_v1` | control / guarantee | Pricing page headline copy |
| `free_tier_cap_v1` | three_per_day / five_per_day | Free tier daily app limit |
| `pro_price_v1` | p1999 / p2499 | Pro monthly price point |

**Flags seeded (all OFF by default):** `resume_quality_v2`, `pdf_templates_v1`, `annual_plans_v1`, `referral_program_v1`

**Anonymous tracking:** `rai_anon` cookie (httpOnly, 1yr, seeded by Edge middleware before SSR). When a user signs up, their future `ExperimentAssignment` rows use `userId`; the `anonId` rows are retained for historical accuracy.

**Conversion tracking convention:**
```ts
await trackEvent({ event: 'checkout_started', userId, properties: { experiment_key, variant } })
```

**Results analysis:**
```bash
npx tsx scripts/experiment_results.ts pricing_headline_v1 checkout_started
```

---

### PMF (Product–Market Fit) tracking (`lib/pmf/`)

| File | Responsibility |
|---|---|
| `lib/pmf/types.ts` | Exit-reason enum + labels |
| `lib/pmf/survey.ts` | `seedDay30Survey()` — idempotent survey creation |
| `app/api/cron/seed-surveys/route.ts` | Cron endpoint seeding day-30 surveys |
| `.github/workflows/seed-surveys.yml` | Daily 9am UTC GitHub Actions trigger |

---

### Telegram Notifications (`notifier/`, `lib/redis.ts`, `lib/telegram-token.ts`)

Outbound-only Telegram bot that pings users for key application events. Users connect once from the dashboard; thereafter they receive real-time notifications without logging in.

**Architecture:**

```
Next.js (web) ──publishEvent()──► Redis channel "application_events"
                                        │
                           notifier/ (Python asyncio)
                           subscribes, handles 3 event types
                                        │
                           Telegram Bot API sendMessage
```

| File | Responsibility |
|---|---|
| `lib/redis.ts` | Singleton ioredis client; `publishEvent(channel, payload)` |
| `lib/telegram-token.ts` | HMAC-signed 5-min connect tokens; `signTelegramToken` / `verifyTelegramToken` |
| `app/api/notifications/telegram/connect/route.ts` | GET status, POST deep-link, PATCH toggles, DELETE disconnect |
| `app/api/notifications/telegram/webhook/route.ts` | Telegram webhook receiver; handles `/start <token>`, `/stop` |
| `app/dashboard/notifications/page.tsx` | Connect/disconnect UI + per-type toggle switches |
| `notifier/main.py` | Redis subscriber; dispatches events to Telegram |
| `notifier/templates.py` | HTML message templates for 3 event types |
| `notifier/rate_limiter.py` | 30 msg/user/hour Redis counter |
| `notifier/database.py` | asyncpg pool; `get_telegram_chat(pool, user_id)` |

**Event types:**
- `application_submitted` — fired from `lib/quota.ts` after successful application
- `interview_reply` — fired from `app/api/inbox/inbound/route.ts` on recruiter email parse
- `linkedin_issue` — fired from `worker/worker/autoapply/common.py` on auth failure

**Connection flow:**
1. User clicks "Connect Telegram" on `/dashboard/notifications`
2. API generates `https://t.me/<BOT>?start=<hmac-token>` deep link (5 min TTL)
3. User taps link → Telegram opens bot chat → `/start <token>`
4. Webhook verifies token → upserts `TelegramChat` → confirms in chat

**DB model:** `TelegramChat` (userId unique, chatId, notifyOnSubmit, notifyOnInterviewReply, notifyOnLinkedInIssue)

**Rate limit:** 30 messages/user/hour via Redis INCR+EXPIRE.

**Security:** Webhook protected by `X-Telegram-Bot-Api-Secret-Token` header (`TELEGRAM_WEBHOOK_SECRET`). Token HMAC uses `NEXTAUTH_SECRET`. Bot token in env var only — never in code.

---

### Notifications (`lib/notifications/`)

Daily digest emails sent to paying users each morning with their previous day's job-application activity.

| File | Responsibility |
|---|---|
| `lib/notifications/digest.ts` | `generateDigest(userId)` — data aggregation; anti-spam rules |
| `lib/notifications/templates/daily-digest.tsx` | React Email template |
| `lib/notifications/unsubscribe-token.ts` | HMAC-signed, no-login unsubscribe tokens |
| `app/api/cron/daily-digest/route.ts` | Timezone-aware cron endpoint (hourly trigger) |
| `app/api/user/notifications/route.ts` | `GET`/`PATCH` user notification prefs |
| `app/api/unsubscribe/route.ts` | One-click unsubscribe (validates token → sets `dailyDigestEnabled = false`) |
| `app/dashboard/settings/notifications/page.tsx` | UI settings toggle + timezone picker |
| `app/unsubscribed/page.tsx` | Confirmation page after unsubscribe |
| `.github/workflows/digest.yml` | Hourly (`0 * * * *`) GitHub Actions trigger |

**Timezone-aware delivery**: The cron runs every hour. Each run checks all paying users with `dailyDigestEnabled = true` and sends only to those whose `timezone` resolves to hour 8 at that moment. This approximates "8am local delivery" within ±30 minutes.

**Anti-spam rules** (enforced in `generateDigest`):
1. `dailyDigestEnabled` must be `true` (honoured via DB column or unsubscribe link)
2. `firstPaidAt` must be set (paying users only)
3. At least 24 hours must have passed since `firstPaidAt` (no same-day digest)
4. At least one application sent or one recruiter reply in the 24-hour window

**Unsubscribe token**: `base64url(userId + "." + HMAC-SHA256(userId, CRON_SECRET))`. Verified with `timingSafeEqual` to prevent timing attacks.

**User DB fields added**: `dailyDigestEnabled BOOLEAN DEFAULT true`, `timezone TEXT DEFAULT 'UTC'`.

---

### Resume & applications (`lib/resume/`, `lib/autoapply/`)

Domain models: `Resume`, `JobApplication`, `AutoApplyCampaign`, `JobListing`, `ApplicationEvent`.

AI tailoring per application is toggled via `User.preferences.tailorApplications` (JSON column). Preferences are managed through `PATCH /api/user/preferences`.

---

### PDF Template System (Prompt 03 — `PDF_TEMPLATES_V1`)

WeasyPrint-based renderer with 5 ATS-safe templates, picker UI, and feature flag.

**Architecture:**

```
Browser ──PATCH /api/resumes/{id}/template──► DB (Resume.templateId)
Browser ──GET  /api/resumes/{id}/pdf       ──► Next.js API route
                                                   │
                                     isPdfTemplatesV1() = true?
                                           YES ↓           NO ↓
                                   adaptResumeData()   legacy reportlab
                                           │
                                   POST /jobs/resumes/{id}/render  (worker)
                                           │
                                   Jinja2 template → HTML string
                                           │
                                   WeasyPrint HTML.write_pdf()
                                           │
                                   application/pdf bytes ──► browser
```

**Key files:**

| File | Responsibility |
|---|---|
| `worker/worker/routes/jobs.py` | `POST /jobs/resumes/{id}/render` — Jinja2 render + WeasyPrint PDF |
| `worker/worker/templates/resumes/_common.css` | Shared print CSS (margins, headings, page-break rules) |
| `worker/worker/templates/resumes/*.html` | 5 Jinja2 templates: `modern_minimalist`, `classic_executive`, `tech_compact`, `creative_accent`, `new_grad` |
| `worker/worker/templates/resumes/_sample_resume.json` | Sample fixture for thumbnail generation + tests |
| `app/api/resumes/[id]/pdf/route.ts` | PDF download endpoint; V1 path calls worker, falls back to reportlab |
| `app/api/resumes/[id]/template/route.ts` | `PATCH` — validates and persists `templateId` to DB |
| `lib/worker-client.ts` | `renderResumePdf()` + `adaptResumeData()` (§3.2 JSON shape adapter) |
| `lib/flags.ts` | `isPdfTemplatesV1()` / `isResumeQualityV2()` env-flag helpers |
| `components/resume/TemplatePicker.tsx` | Client component — grid of 5 templates, save + download buttons |
| `app/dashboard/resumes/[id]/page.tsx` | Renders `<TemplatePicker>` when `PDF_TEMPLATES_V1=true` |
| `public/template-thumbnails/*.svg` | SVG placeholder thumbnails (real PNGs via `regenerate_thumbnails.py`) |
| `worker/scripts/regenerate_thumbnails.py` | WeasyPrint + pdf2image → PNG thumbnails (run on VPS) |

**Feature flag:** `PDF_TEMPLATES_V1=true` in env. Set to `false` (default) to fall through to the legacy reportlab endpoint. Controlled independently in web (`lib/flags.ts`) and worker (`worker/worker/config.py`).

**§3.2 JSON adapter (`adaptResumeData`):** The existing `generated` JSON field may contain `{ resume_text: "..." }` (V1 plain text), `{ resume_structured: {...} }` (V2 structured), or a raw structured object. The adapter normalises all three shapes into the `{ name, summary, experience[], education[], skills, projects[] }` dict that the Jinja2 templates expect.

**ATS constraints enforced in all templates:**
- Single-column layout; no `<table>` elements
- Contact info in `<body>`, not `<header>` or ARIA landmark
- Standard section headings ("Experience", "Education", "Skills")
- Web-safe fonts only: Calibri, Garamond, Helvetica, Arial
- Margins 0.45"–0.6"; `page-break-inside: avoid` on entries

**System deps (Docker only):** `libpangoft2-1.0-0 libgdk-pixbuf2.0-0 libffi-dev shared-mime-info` added to `worker/Dockerfile` apt-get stage.

---

### CareerOps autoapply pipeline (`app/api/cron/run-campaigns/`, `worker/worker/autoapply/careerops.py`)

End-to-end automated job application system.  Triggered every 2 hours by GitHub Actions (`.github/workflows/run-campaigns.yml`) via `POST /api/cron/run-campaigns`.

**Run-campaigns flow:**
```
GitHub Actions (every 2h)
  └─► POST /api/cron/run-campaigns   (Bearer CRON_SECRET)
        │
        ├─ Load active CAREEROPS campaigns (Prisma)
        │
        └─ For each campaign:
             ├─ Scrape 100+ jobs from RemoteOK (4 tag variants) + TheMuse (3 keyword variants) + Adzuna (if keys set)
             │   → all boards called in parallel via Promise.all
             │   → dedup by apply_url
             │   → upsert to JobListing table
             │
             ├─ Skip: already-applied URLs, blocked companies, quota exhausted
             │
             ├─ Cap: MAX 3 Playwright applies per cron run (prevents OOM)
             │
             └─ For each new job (up to cap):
                  ├─ Create JobApplication (QUEUED)
                  ├─ POST /jobs/autoapply/careerops  → worker (Playwright ATS filler)
                  │   Supports: Greenhouse, Lever, Workable, SmartRecruiters, Jobvite, Ashby, Generic
                  ├─ Update status: SUBMITTED or FAILED
                  ├─ consumeQuota() → stamps appliedAt + publishes Redis event
                  └─ Telegram notification fires via notifier/
```

**Key limits:**
- `campaign.dailyLimit` — per-campaign cap (default 20/day)
- `user.dailyApplicationLimit` — per-user cap (admin: 50, free: 3)
- `MAX_APPLIES_PER_RUN = 3` — hard cap per 2h cron trigger (prevents Playwright OOM)
- 12 triggers/day × 3 = up to 36 applications/day through normal operation

**Playwright in Docker:**
- Worker Dockerfile installs Chromium via `playwright install chromium` into `/ms-playwright`
- `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` ensures the worker process finds the binary
- Worker container has `memory: 1500m` Docker limit to prevent host OOM

**Job boards (no API keys needed):**
- **Greenhouse** (PRIMARY): queries 20 major tech companies' public Greenhouse boards in parallel via `boards-api.greenhouse.io/v1/boards/{company}/jobs`. Returns `job-boards.greenhouse.io/{company}/jobs/{id}` URLs that CareerOps can fill directly. 370+ engineering jobs per run. File: `worker/worker/scrapers/greenhouse.py`.
- RemoteOK: public JSON API, tag-based search — 30 jobs/tag. Returns `remoteOK.com` listing pages (not direct ATS) — these are filtered out by `isBoardUrl()` in `run-campaigns/route.ts`.
- TheMuse: public API, keyword categories — 20 jobs/keyword. Also returns listing pages (filtered out).
- Adzuna: requires `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` env vars (silently skipped if absent).

**OOM protection (critical):**
- `MAX_APPLIES_PER_RUN = 3` cap counts ALL Playwright attempts (not just successes). Previously only counted SUBMITTED apps — 100 failing timeouts would all start before cap fired.
- `isBoardUrl()` filter uses case-insensitive match (`url.toLowerCase()`): RemoteOK returns `remoteOK.com` with capital letters that bypassed a lowercase-only check.
- Docker memory limit `1500m` on worker container prevents host OOM.

---

### Chrome Extension (`extension/`)

Manifest v3 browser extension — "ResumeAI Autofill" v1.0.0.  Lets users autofill job-application forms on ATS sites using their saved ResumeAI resume, without copy-pasting.

**Supported ATS platforms:**
- Greenhouse (`boards.greenhouse.io`, `*.greenhouse.io/jobs/*`)
- Lever (`jobs.lever.co`)
- Workable (`apply.workable.com`)
- SmartRecruiters (`jobs.smartrecruiters.com`)
- Jobvite (`jobs.jobvite.com`)
- Ashby (`jobs.ashbyhq.com`)
- LinkedIn Easy Apply (`linkedin.com/jobs`)
- Workday (`*.myworkdayjobs.com`)
- iCIMS (`*.icims.com`)
- Taleo (`*.taleo.net`)

**Architecture:**

```
popup/popup.html          ← "Autofill" button UI
  └─► background.js       ← Service worker; fetches resume from API
        └─► content/
              detect.js   ← Detects which ATS the current page uses
              autofill.js ← Fills form fields with resume data
              overlay.js  ← Visual feedback overlay
content/connect-bridge.js ← Handles OAuth connect flow from resumeai-bot.ru/extension/connect
```

**Connection flow:**
1. User installs extension → clicks "Connect" in popup
2. Extension opens `https://resumeai-bot.ru/extension/connect` in a tab
3. `connect-bridge.js` fires a `postMessage` with a signed token back to the extension
4. Extension stores the token in `chrome.storage.local` for subsequent API calls

**Permissions:** `storage`, `activeTab`, `scripting`.  
**Host permissions:** `https://resumeai-bot.ru/*` (API calls only — no cross-origin scraping).

**Distribution:** Load unpacked from `extension/` in Chrome Developer Mode.  No Chrome Web Store listing yet.

---

### Auth (`lib/auth.ts`) — providers

NextAuth.js with JWT strategy supports three providers:

| Provider | Purpose |
|---|---|
| Google OAuth | Primary social login |
| GitHub OAuth | Secondary social login |
| Email (magic link) | Passwordless login via Resend |

Session fields are enriched with Stripe billing data and PMF tracking fields. See `types/next-auth.d.ts`.

---

### Audit & observability

| Model | Purpose |
|---|---|
| `AuditLog` | Write-path actions (refunds, plan changes, cancellations) |
| `ActivityLog` | Read-path actions |
| `AnalyticsEvent` | Front-end analytics events |

Helper: `createAuditLog(action, resource, resourceId, changes?)` in `lib/audit.ts`.

---

## Data flow: daily digest

```
GitHub Actions (hourly)
  └─► POST /api/cron/daily-digest
        Bearer CRON_SECRET auth
        │
        ├─ query User WHERE firstPaidAt IS NOT NULL
        │                AND dailyDigestEnabled = true
        │
        ├─ filter: getCurrentHourInTimezone(user.timezone) === 8
        │
        └─ for each matching user:
             generateDigest(userId)
               ├─ query JobApplication WHERE appliedAt in [yesterday]
               ├─ query JobApplication WHERE responseAt in [yesterday]
               └─ return null if nothing happened
             render DailyDigestEmail (React Email → HTML)
             sendEmail() via Resend
```

## Data flow: 30-day refund

```
User clicks "Confirm refund" on /dashboard/billing
  └─► POST /api/billing/refund
        getServerSession (auth)
        checkRefundEligibility(user)   ← lib/billing/refund.ts
        stripe.refunds.create(chargeId)
        stripe.subscriptions.cancel(subscriptionId)
        prisma.user.update({ refundedAt, cancelledAt, stripe fields → null })
        sendRefundConfirmationEmail()
```
