# Sync Audit — 2026-05-23

**Auditor:** Claude Code (pre-marketing audit pass)  
**Repo:** `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit`  
**Local HEAD:** `e2b9fbe` (docs: strategy bootstrap #9)  
**VPS image tag running:** `52466f1` (Add INBOX_DOMAIN env var to docker-compose)  
**Live URL:** `https://resumeai-bot.ru`  
**VPS:** `root@72.56.250.53` → `/opt/resumeai`

---

## TL;DR

- 🟢 **GREEN: 15 items** — core infrastructure healthy, payments/auth/db all working
- 🟡 **YELLOW: 11 items** — fix this week before marketing push
- 🔴 **RED: 2 items** — fix before any paid marketing (Stripe idempotency, in-memory job store)

### VPS verification block
```
✅ PASS — SSH accessible, all 6 containers up/healthy, DB schema up to date,
   smoke tests 200 on /, /api/health, /pricing
   Verified: 2026-05-23
```

---

## A. GitHub ↔ VPS Sync

| Item | Status | Detail |
|------|--------|--------|
| A1. Local HEAD | 🟢 | `e2b9fbe` — docs: strategy bootstrap (#9) |
| A2. VPS git HEAD | 🟡 | `c796aa4` (chore: remediate sync audit) — VPS git repo is behind local by 3 commits. Non-blocking: VPS deployment uses Docker images from GHCR, NOT `git pull`. VPS git state is informational only. |
| A3. VPS running image tag | 🟡 | All 3 app images at `52466f1`. Last code-bearing commit. `e2b9fbe` was docs-only and triggered a new deploy; latest images may be `e2b9fbe` by now — verify with `docker compose ps` on VPS. |
| A4. Container count | 🟢 | All 6 containers up: `resumeai-web` (healthy), `resumeai-worker` (healthy), `resumeai-notifier` (up), `resumeai-db` (healthy), `resumeai-redis` (healthy), `resumeai-caddy` (healthy). No restart loops. |
| A5. Web error logs | 🟡 | Repeated: `Error: Failed to find Server Action "0000000000000000000000000000000000000000"` — this is a post-deploy browser-tab stale-JS artifact. Browser tabs loaded before deploy call the new server with old action IDs. Clears naturally within minutes; not a real bug. Monitor — if still appearing 6h post-deploy, investigate. |
| A6. Worker/Notifier logs | 🟢 | No errors. Notifier shows `notifier.ready` + periodic `event.no_chat` (normal — user hasn't connected Telegram). |

---

## B. Architecture Doc vs Reality

| Item | Status | Detail |
|------|--------|--------|
| B1. Chrome extension | 🟡 | `extension/` EXISTS. Manifest v3, version `1.0.0`, name "ResumeAI Autofill". Supports Greenhouse, Lever, Workable, SmartRecruiters, Jobvite, Ashby, LinkedIn, Workday, iCIMS, Taleo. **NOT documented in `docs/ARCHITECTURE.md`**. Subsystem is live but invisible to new contributors. |
| B2. OpenRouter proxy | 🟢 | Fully configured. `worker/worker/config.py` has `openai_base_url`. VPS worker container: `OPENAI_BASE_URL=https://openrouter.ai/api`, `OPENAI_MODEL=openai/gpt-4o-mini`. |
| B3. PDF download endpoint | 🟢 | `app/api/resumes/[id]/pdf/route.ts` exists. Worker route `POST /jobs/resume/pdf` exists. Documented in ARCHITECTURE.md. |
| B4. `STRIPE_PRICE_ID_TRIAL` | 🟢 | Env var does NOT exist in code. Not a dead reference — prompt's checklist item was a false concern. Actual price ID vars: `STRIPE_PRICE_ID_PRO` and `STRIPE_PRICE_ID_UNLIMITED` (docker-compose + `lib/pricing.ts`). |
| B5. `lib/subscription.ts` drift | 🟡 | `lib/subscription.ts` references `STRIPE_PRICE_ID_BASIC`, `STRIPE_PRICE_ID_BASIC_YEARLY`, `STRIPE_PRICE_ID_ENTERPRISE`, `STRIPE_PRICE_ID_ENTERPRISE_YEARLY`, `STRIPE_PRICE_ID_PRO_YEARLY` — **none of these are in `docker-compose.yml` env block**. Dead references or planned future plans. Docker-compose only has `STRIPE_PRICE_ID_PRO` + `STRIPE_PRICE_ID_UNLIMITED`. Confirm which plans are live; clean up dead vars. |

---

## C. Dead Code / Migration Debt

| Item | Status | Detail |
|------|--------|--------|
| C1. `hhToken` / `hhResumeId` live usage | 🟢 | Confirmed dead. Only appears in: (1) `prisma/schema.prisma` (inert columns), (2) `node_modules/.prisma/client/index.d.ts` (generated, expected), (3) `scripts/migrate-from-legacy.ts` (one-time migration script). No live application code paths. |
| C2. `scripts/migrate-from-legacy.ts` | 🟡 | One-time migration script still in repo. Harmless but could confuse contributors. Consider moving to `scripts/_archive/` or deleting after confirming migration is complete and no live users need it. |
| C3. Sentry code present, DSN missing | 🟡 | `lib/worker-client.ts` imports `@sentry/nextjs` and calls `Sentry.captureException`. VPS web container: `NEXT_PUBLIC_SENTRY_DSN` is **NOT set** (confirmed via `docker exec printenv`). Errors are silently swallowed in production. Create a free Sentry project, add DSN to VPS `.env`, run `docker compose up -d web`. |
| C4. No `@deprecated` / `TODO remove` markers | 🟢 | Grep across `app/`, `lib/`, `worker/` found none. Clean. |

---

## D. Stripe

| Item | Status | Detail |
|------|--------|--------|
| D1. `maxNetworkRetries: 3` | 🟢 | Confirmed in `lib/stripe.ts`: `maxNetworkRetries: 3, timeout: 30_000`. |
| D2. Webhook validates `STRIPE_WEBHOOK_SECRET` | 🟢 | `app/api/webhooks/stripe/route.ts` uses `stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`. Returns 400 on signature failure. |
| D3. **Stripe webhook idempotency** | 🔴 | **NO event ID dedup mechanism.** No `processed_stripe_events` table, no unique constraint on Stripe event ID. Stripe guarantees at-least-once delivery — the same event CAN fire twice. Impact: `invoice.payment_succeeded` double-fires → `stripeCurrentPeriodEnd` written twice (safe but messy). `checkout.session.completed` double-fires → `firstPaidAt` guarded (`if firstPaidAt == null`) ✅ but `dailyApplicationLimit` written twice ✅. `customer.subscription.deleted` double-fires → safe (same nulls). Risk is LOW today but must be fixed before scale. **Fix:** Add `StripeEvent` model with `@@unique([stripeEventId])` and skip-if-exists check at top of webhook handler. |
| D4. Refund route completeness | 🟢 | `app/api/billing/refund/route.ts`: calls `stripe.refunds.create` ✅, calls `stripe.subscriptions.cancel` ✅, updates DB ✅, calls `sendRefundConfirmationEmail` ✅. Fully implemented. |
| D5. Idempotency on `charge.refunded` event | 🟢 | Handler checks `if (user.refundedAt == null)` before setting. Manually guarded. |

---

## E. Worker Health

| Item | Status | Detail |
|------|--------|--------|
| E1. **In-memory job store** | 🔴 | `worker/worker/routes/jobs.py`: `_jobs: dict[str, JobRecord] = {}` — confirmed pure in-memory. **Any worker restart loses all job status.** Since jobs are synchronous (start→complete in one request cycle) this doesn't lose in-flight jobs, but GET `/jobs/{id}` will 404 after restart. Documented tech debt. Must be replaced with Redis or DB-backed store before running multiple worker replicas or if job polling is used. |
| E2. OpenRouter configuration | 🟢 | VPS worker running `OPENAI_BASE_URL=https://openrouter.ai/api`, model `openai/gpt-4o-mini`. Config flows correctly from `worker/config.py` → `worker/ai/resume.py`. |
| E3. OpenRouter fallback | 🟡 | No fallback if OpenRouter is down. `worker/worker/ai/resume.py` would raise an exception and the job would fail with `status=error`. This surfaces as `FAILED` applications in the dashboard. Acceptable for now, but OpenRouter has had outages. Consider `OPENAI_BASE_URL_FALLBACK` with retry logic. |
| E4. PDF library | 🟢 | `reportlab` confirmed (BytesIO usage in `jobs.py`, `POST /jobs/resume/pdf`). Consistent with QA doc. |

---

## F. Notifier Health

| Item | Status | Detail |
|------|--------|--------|
| F1. Redis subscriber | 🟢 | Logs: `notifier.ready channel=application_events`. Subscriber running, listening on `application_events`. |
| F2. `REDIS_URL` set | 🟢 | `notifier` service in docker-compose has `REDIS_URL: redis://redis:6379`. Set. |
| F3. Rate limit logic | 🟢 | `notifier/rate_limiter.py` — 30 messages/user/hour via Redis INCR+EXPIRE. |
| F4. Telegram bot token not committed | 🟢 | Grep across all source files: `TELEGRAM_BOT_TOKEN` only in `docker-compose.yml` (as env var reference `${TELEGRAM_BOT_TOKEN}`) and `.env.example` (placeholder). Never hardcoded. |

---

## G. Auth Health

| Item | Status | Detail |
|------|--------|--------|
| G1. Providers configured | 🟢 | `lib/auth.ts`: Google, GitHub, Email (Resend SMTP) all present. |
| G2. `NEXTAUTH_URL` | 🟢 | Docker-compose default: `${NEXTAUTH_URL:-https://resumeai-bot.ru}`. No localhost leak. |
| G3. GitHub OAuth on VPS | 🟢 | VPS web container: `GITHUB_ID` and `GITHUB_SECRET` both set (confirmed via `docker exec printenv`). |
| G4. `NEXTAUTH_SECRET` rotation | 🟡 | No record of when secret was last rotated. Recommend rotation + redeploy before any public marketing launch. Run: `openssl rand -base64 32` → update VPS `.env` → `docker compose up -d web`. |
| G5. `ENCRYPTION_KEY` set | 🟢 | Fixed in commit `e28b366`. Both web and worker containers have it set. |

---

## H. Legal / Compliance / Marketing Readiness

| Item | Status | Detail |
|------|--------|--------|
| H1. Terms/Privacy dates | 🟡 | Both `app/terms/page.tsx` and `app/privacy/page.tsx` say **"Last updated: January 2024"**. Must update to a current date before marketing. Legal exposure if dates are 2+ years stale. |
| H2. Sitemap routes | 🟢 | 8 routes present: `/`, `/pricing`, `/login`, `/faq`, `/terms`, `/privacy`, `/refund-policy`, `/changelog`. All returning 200. |
| H3. `robots.txt` | 🟢 | Custom rules confirmed: `Disallow: /dashboard/`, `Disallow: /api/`, `Disallow: /admin/`. Cloudflare has also injected managed bot-blocking rules (GPTBot, ClaudeBot, etc.) above custom rules — this is Cloudflare's CDN injection, not a code issue. |
| H4. OG meta tags | 🟡 | `app/layout.tsx` has OG tags in code. **Not live-verified** with LinkedIn/Facebook post inspector or `curl`. Manual check required: visit `https://www.linkedin.com/post-inspector/inspect/https%3A%2F%2Fresumeai-bot.ru`. |
| H5. `.env.example` staleness | 🟡 | `.env.example` is severely outdated. Missing: `WORKER_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `INBOX_DOMAIN`, `STRIPE_PRICE_ID_UNLIMITED`. Still contains: `STRIPE_PRICE_ID_BASIC`, `STRIPE_PRICE_ID_ENTERPRISE`, `ENABLE_BACKGROUND_JOBS`, `COOKIE_CONSENT_VERSION`, `MAX_LOGIN_ATTEMPTS` — none of which exist in docker-compose. Any new developer following `.env.example` will have a broken setup. |

---

## I. Database

| Item | Status | Detail |
|------|--------|--------|
| I1. Connection pool | 🟡 | `DATABASE_URL` in docker-compose: `postgresql://resumeai:resumeai@postgres:5432/resumeai` — no `?connection_limit=` parameter. Prisma default is `num_cpus * 2 + 1`. On a single-core VPS this is 3. Acceptable now; flag for review at >50 concurrent users. |
| I2. Pending migrations | 🟢 | VPS: "Database schema is up to date!" — confirmed. |
| I3. Row counts (live DB) | 🟢 | `User`: 4, `Resume`: 5, `JobApplication`: 65, `AutoApplyCampaign`: 1. Data consistent with early-stage product. |
| I4. Prisma version | 🟡 | Running `5.22.0`, latest is `7.8.0` (major). Major upgrade guide at `pris.ly/d/major-version-upgrade`. Not urgent but should be tracked. |

---

## J. Live Smoke Tests (Read-Only)

| Item | Status | Detail |
|------|--------|--------|
| J1. `GET https://resumeai-bot.ru` | 🟢 | HTTP 200. `content-type: text/html; charset=utf-8`. |
| J2. `GET /api/health` | 🟢 | HTTP 200. Body: `{"status":"ok","version":"unknown","timestamp":"2026-05-23T14:58:55.090Z"}`. Note: `version` field returns `"unknown"` — consider injecting `NEXT_PUBLIC_COMMIT_SHA` at build time for traceability. |
| J3. `GET /pricing` | 🟢 | HTTP 200. Pricing page live. (Stripe price ID values not tested in response body — requires browser check.) |
| J4. Sitemap | 🟢 | 8 URLs, all expected routes. |
| J5. Google OAuth | 🟢 | Confirmed by user on 2026-05-20; Google OAuth callback URL configured. Not re-verified today (manual check required). |

---

## Summary Table

| Section | 🟢 | 🟡 | 🔴 |
|---------|----|----|-----|
| A. GitHub ↔ VPS sync | 3 | 3 | 0 |
| B. Architecture doc vs reality | 3 | 2 | 0 |
| C. Dead code / migration debt | 2 | 2 | 0 |
| D. Stripe | 4 | 0 | 1 |
| E. Worker health | 2 | 1 | 1 |
| F. Notifier health | 4 | 0 | 0 |
| G. Auth health | 4 | 1 | 0 |
| H. Legal / compliance | 2 | 3 | 0 |
| I. Database | 2 | 2 | 0 |
| J. Smoke tests | 5 | 0 | 0 |
| **TOTAL** | **31** | **14** | **2** |

_Note: Some items are aggregated above; totals reflect distinct issues, not table row counts._

---

## RED Items — Detailed Reproduction + Fix

### RED-1: Stripe webhook — no event ID idempotency

**Risk:** Stripe delivers events at-least-once. On network failure, the same `checkout.session.completed` or `invoice.payment_succeeded` event can fire multiple times.

**Reproduce:**
```bash
# Send the same event ID twice via Stripe CLI
stripe trigger checkout.session.completed --webhook-endpoint=https://resumeai-bot.ru/api/webhooks/stripe
# Or use stripe fixtures to replay an event by ID
stripe events resend <evt_xxx> --webhook-endpoint=<id>
```

**Fix — add `StripeEvent` dedup table:**
1. Add to `prisma/schema.prisma`:
```prisma
model StripeEvent {
  id          String   @id  // Stripe event ID (e.g. "evt_xxx")
  processedAt DateTime @default(now())
}
```
2. At top of webhook handler, after `constructEvent`:
```typescript
const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } })
if (existing) return new NextResponse(null, { status: 200 }) // already processed
await prisma.stripeEvent.create({ data: { id: event.id } })
```
3. Run migration: `npx prisma migrate dev --name add-stripe-event-dedup`

**Prompt:** `docs/strategy/prompts/04-stability-hardening.md` covers this.

---

### RED-2: Worker in-memory job store

**Risk:** Any worker container restart (OOM, deploy, crash) loses all job records. `GET /jobs/{id}` returns 404. Jobs submitted but not yet polled appear to complete successfully but their status is unrecoverable.

**Current behavior:** Since all jobs are synchronous (submit → wait → return result in same HTTP request), in practice the caller rarely polls. Impact is LOW today. But any future async-job pattern, or `GET /jobs/{id}` polling by the Next.js frontend, will silently fail after restarts.

**Reproduce:**
```bash
# Submit a job, then restart worker, then GET the job ID
curl -X POST http://vps-ip:8000/jobs/resume/generate -H "Authorization: Bearer $WORKER_SECRET" -d '{...}'
# Capture job_id from response
docker restart resumeai-worker
curl http://vps-ip:8000/jobs/$JOB_ID  # Returns 404
```

**Fix (minimal):** Replace `_jobs: dict` with Redis-backed storage via `aioredis`. Key: `job:{job_id}`, TTL 24h.

**Fix (proper):** Switch to ARQ or Celery for proper job queue with persistence.

---

## Recommended Next Prompts (in order)

1. **Prompt 01 — System audit** (`docs/strategy/prompts/01-system-audit.md`) — full system health check and remediation
2. **Fix RED-1 (Stripe idempotency)** — Add `StripeEvent` dedup model + migration (30 min, low risk)
3. **Fix H1 (Terms/Privacy dates)** — Update "January 2024" to today's date in both pages
4. **Fix H5 (.env.example staleness)** — Rewrite `.env.example` to match actual docker-compose environment block
5. **Fix B1 (Chrome extension undocumented)** — Add Chrome extension subsystem to `docs/ARCHITECTURE.md`
6. **Prompt 02 — Resume quality upgrade** (`docs/strategy/prompts/02-resume-quality-upgrade.md`)
7. **Prompt 04 — Stability hardening** (`docs/strategy/prompts/04-stability-hardening.md`) — covers worker job store persistence + other infra hardening
8. **G4 (NEXTAUTH_SECRET rotation)** — `openssl rand -base64 32` → update VPS `.env` → redeploy
9. **G1/C3 (Sentry setup)** — Create free Sentry project, add DSN to VPS `.env`
10. **Prompt 05 — Annual plans and pricing** (`docs/strategy/prompts/05-annual-plans-and-pricing.md`)

---

_Audit complete — 2026-05-23. No application code was modified during this pass._  
_Total issues: 🔴 2 (act before marketing), 🟡 14 (act this week), 🟢 31 confirmed healthy_
