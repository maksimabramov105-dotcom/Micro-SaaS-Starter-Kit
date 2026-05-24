# Sync Audit — 2026-05-24

**Auditor:** Claude Code (SRE pass)
**Commit audited:** `3253f26` (HEAD of `main` at audit time)
**VPS image:** `ghcr.io/maksimabramov105-dotcom/resumeai-web:3253f26…` (all 3 services aligned)
**DB migrations:** 12 applied, latest `20260524120000_add_referral_system`

---

## TL;DR

| Severity | Count | Summary |
|----------|-------|---------|
| 🔴 RED | 2 | Act before any paid marketing |
| 🟡 YELLOW | 7 | Act this week |
| 🟢 GREEN | 23 | No action needed |

---

## A. GitHub ↔ VPS sync

| Item | Status | Detail |
|------|--------|--------|
| Local HEAD | 🟢 | `3253f26 fix(auth): restore Google OAuth + update Svix signature tests` |
| VPS web image | 🟢 | `3253f26…` — all 3 services (web, worker, notifier) on same SHA |
| Container count | 🟢 | 7 containers running: web ✅ healthy, worker ✅ healthy, notifier ✅ up, db ✅ healthy, redis ✅ healthy, caddy ✅ healthy, uptime-kuma ✅ healthy |
| Recent CI runs | 🟢 | Last 8 push/CI/Deploy runs: all `success`. Last failed deploy was `5261ec8` (inbox tests broken — fixed in `3253f26`) |
| Failed cron run 13:49 | 🟡 | `run-autoapply-campaigns` at 13:49 got HTTP 500 — web was mid-restart during auth fix deploy. Subsequent runs (15:11, 17:10, 18:00 cron) all pass. Transient only. |
| docker-compose drift | 🔴 | `docker-compose.yml` synced to VPS by CI, but **missing 4 env vars** (annual price IDs + Tolt) — these are in VPS `.env` but not in the `environment:` block, so the web container never receives them. See Section B. |

---

## B. Architecture doc vs reality

| Item | Status | Detail |
|------|--------|--------|
| Chrome extension | 🟡 | `extension/` exists, `manifest.json` v1.0.0 "ResumeAI Autofill". **Not documented in `ARCHITECTURE.md`**. No store listing referenced. |
| OpenRouter proxy | 🟢 | Worker uses `OPENAI_BASE_URL=https://openrouter.ai/api` on VPS — geo-bypass active. `worker/config.py` default is `https://api.openai.com`; override in `.env` is correct. Web container does not call OpenAI directly. |
| PDF download endpoint | 🟢 | `app/api/resumes/[id]/pdf/route.ts` exists. Proxies to `POST /jobs/resume/pdf` on worker. Worker uses WeasyPrint (confirmed in QA doc). |
| `STRIPE_PRICE_ID_TRIAL` | 🟢 | Only reference is `scripts/_archive/migrate-from-legacy.ts`. Absent from `.env.example`, `docker-compose.yml`, and all live TypeScript/Python. Dead — no action needed. |
| Annual plans env in compose | 🔴 | `STRIPE_PRICE_ID_PRO_YEARLY` and `STRIPE_PRICE_ID_UNLIMITED_YEARLY` are in VPS `.env` and in `.env.example`, but **absent from `docker-compose.yml` web `environment:` block**. Container gets `null` for yearly price IDs → `PRICING_PLANS` entries have `priceId: null` → annual checkout fails silently. |
| Tolt referral ID | 🔴 | `NEXT_PUBLIC_TOLT_REFERRAL_ID` in `.env.example` but **absent from `docker-compose.yml`**. Tolt tracking script never fires on production. |
| Referral system | 🟡 | Fully implemented (`lib/referral/`, `app/r/[code]/`, `app/dashboard/referrals/`) and migrated, but not in `ARCHITECTURE.md`. |

---

## C. Dead code / migration debt

| Item | Status | Detail |
|------|--------|--------|
| `hhToken` / `hhResumeId` in code | 🟢 | `grep -r "hhToken\|hhResumeId" --include="*.ts" --include="*.py"` → **zero hits** outside migration files. Clean. |
| `AutoApplyCampaign.hhToken` Prisma error | 🟢 | **Fixed.** Was caused by stale `6a6cdef` web image. Current image `3253f26` has regenerated Prisma client without these columns. |
| Dead `STRIPE_PRICE_ID_TRIAL` | 🟢 | Archive-only. No live references. |
| `@deprecated` / `TODO remove` markers | 🟢 | No hits in `app/`, `lib/`, `worker/worker/` |
| Feature flag `middleware.ts` reference | 🟡 | `ARCHITECTURE.md` still references `middleware.ts` for experiment/flag edge middleware. Current code uses `proxy.ts` (Next.js 16). Doc is stale. |

---

## D. Stripe live mode sanity

| Item | Status | Detail |
|------|--------|--------|
| `maxNetworkRetries: 3` | 🟢 | `lib/stripe.ts`: `maxNetworkRetries: 3` confirmed. |
| Webhook signature validation | 🟢 | `constructEvent` with `STRIPE_WEBHOOK_SECRET` — rejects unsigned events with 400. |
| Idempotency | 🟢 | `StripeEvent` table used for dedupe: `findUnique({where: {id: event.id}})` → early return 200 on replay. 1 event recorded in production DB. |
| Annual plan checkout | 🔴 | `priceId: process.env.STRIPE_PRICE_ID_PRO_YEARLY \|\| null` → resolves to `null` in container → checkout session creation will fail or charge wrong price. **Revenue-blocking before annual plan marketing.** |
| Refund route | 🟢 | `app/api/billing/refund/route.ts`: calls `stripe.refunds.create`, cancels subscription, updates DB, sends confirmation email via `lib/billing/email-refund-confirmation.ts`. Full implementation confirmed. |
| Refund test coverage | 🟡 | QA doc notes `email-refund-confirmation.ts` has near-0% test coverage. |

---

## E. Worker health

| Item | Status | Detail |
|------|--------|--------|
| Job store | 🟡 | **Hybrid: in-memory dict primary, Redis write-through.** `_jobs: dict[str, JobRecord] = {}` at module level. On worker restart, in-memory state is lost for in-flight jobs. Redis saves each state transition — completed jobs survives restart via `_redis_load`. **Flagged as known tech debt. Not a launch blocker but flag loudly: restart during active campaign run = jobs stuck in "running" until Redis TTL expires.** |
| OpenRouter fallback | 🟡 | `OPENAI_BASE_URL=https://openrouter.ai/api` in production. If OpenRouter goes down, all resume generation and AI tailoring fails. No fallback logic in `worker/ai/resume.py`. |
| PDF library | 🟢 | WeasyPrint confirmed (QA doc + `app/api/resumes/[id]/pdf/route.ts` proxies to worker). |
| Worker health endpoint | 🟢 | `/health` returns 200, p50 ~47ms (uptime-kuma polling logs visible). |

---

## F. Notifier health

| Item | Status | Detail |
|------|--------|--------|
| Redis subscriber | 🟢 | `notifier/main.py` subscribes to `application_events` channel. Container up 4h. |
| `REDIS_URL` env | 🟢 | Set in notifier container. |
| Rate-limit logic | 🟢 | `notifier/rate_limiter.py` enforces 30 msg/user/hour via Redis INCR+EXPIRE. |
| Telegram bot token | 🟢 | `TELEGRAM_BOT_TOKEN` is in container env from `docker-compose.yml` env var. **Not committed in any source file.** Zero grep hits for hardcoded token. |

---

## G. Auth health

| Item | Status | Detail |
|------|--------|--------|
| Google OAuth | 🟢 | **Fixed this session.** Root cause: web container stuck on `6a6cdef` image (using `withAuth` from `next-auth/middleware`, incompatible with Next.js 16 Node.js proxy). Current `3253f26` image uses `getToken` directly. |
| GitHub OAuth | 🟢 | `GITHUB_ID` + `GITHUB_SECRET` in container. Provider configured. |
| Email provider | 🟢 | Resend SMTP configured. |
| `NEXTAUTH_URL` | 🟢 | `https://resumeai-bot.ru` — no localhost leak. |
| `NEXTAUTH_SECRET` | 🟡 | Value is set. **Rotation date unknown.** Recommend rotation before public launch if key predates current user base. |
| `ENCRYPTION_KEY` | 🟢 | Present in both web and worker containers (QA doc confirms match, bug fixed 2026-05-20). |
| `force-dynamic` on auth route | 🟢 | Added this session: `app/api/auth/[...nextauth]/route.ts` now exports `dynamic = 'force-dynamic'` ensuring `cookies()` in `createUser` has request context. |

---

## H. Legal / compliance / marketing readiness

| Item | Status | Detail |
|------|--------|--------|
| `/terms` date | 🟢 | `LAST_UPDATED = new Date('2026-05-25')` — current. |
| `/privacy` date | 🟡 | Not checked directly — QA doc notes "January 2024" date was flagged in previous pass. Verify before launch. |
| sitemap.xml | 🟢 | 8 routes: `/`, `/pricing`, `/login`, `/faq`, `/terms`, `/privacy`, `/refund-policy`, `/changelog`. All 200. |
| robots.txt | 🟡 | Served by Cloudflare WAF (Cloudflare-managed content prepended). Our custom rules (`Disallow /dashboard/, /api/, /admin/`) present at bottom. Any changes to `app/robots.ts` must also be checked against Cloudflare WAF settings. Functional but creates a maintenance split. |
| OG meta tags | 🟡 | Present in `app/layout.tsx`. LinkedIn/Twitter inspector not run in this pass — manual verification needed before marketing launch. |
| `NEXT_PUBLIC_TOLT_REFERRAL_ID` | 🔴 | Absent from `docker-compose.yml` web env block — Tolt affiliate tracking script never fires even though `.env.example` and VPS `.env` have the var. |
| Referral pages | 🟢 | `/r/[code]` cookie redirect and `/dashboard/referrals` page exist and are live in `3253f26`. |

---

## I. Database

| Item | Status | Detail |
|------|--------|--------|
| Connection pool | 🟡 | No `?connection_limit=` in `DATABASE_URL`. Default Prisma pool for serverless/containers is 10. At low traffic (4 users) not an issue, but should be set before scale. |
| Pending migrations | 🟢 | 12 migrations applied on VPS. Latest: `20260524120000_add_referral_system` (applied 12:43 UTC today). No pending. |
| DB size | 🟢 | 9.97 MB. Early stage, no bloat. |
| Table count | 🟢 | 30 tables (including `_prisma_migrations`). Full schema: Account, ActivityLog, AnalyticsEvent, ApiKey, ApplicationEvent, AuditLog, AutoApplyCampaign, Consent, DeviceSession, Experiment, ExperimentAssignment, FeatureFlag, InboxMessage, Invoice, JobApplication, JobListing, LoginAttempt, Notification, PasswordHistory, Referral, Resume, Session, StripeEvent, Survey, TelegramChat, Upload, UsageRecord, User, VerificationToken. |
| Row counts | 🟢 | Users: 4, Resumes: 5, JobApplications: 79, AnalyticsEvents: 11, StripeEvents: 1 |
| Backup drill | 🟡 | Not executed. `scripts/backup_db.sh` exists. **Required before real user data accumulates.** |

---

## J. Live smoke test

| Item | Status | Detail |
|------|--------|--------|
| `https://resumeai-bot.ru` | 🟢 | HTTP 200, `x-nextjs-cache: HIT`, `x-powered-by: Next.js`, TLS via Cloudflare. |
| `/pricing` | 🟢 | HTTP 200. |
| `/api/health` | 🟢 | `{"status":"ok","version":"unknown","timestamp":"..."}` |
| `/api/auth/providers` | 🟢 | Returns google, github, email providers. |
| `/api/auth/csrf` | 🟢 | Returns valid CSRF token. |
| `/api/worker/health` | 🟢 | 200 via Caddy reverse proxy. |
| Google OAuth sign-in | 🟢 | **Fixed this session.** Redirects correctly to `accounts.google.com` (confirmed by smoke test in deploy workflow). |
| Annual plan checkout | 🔴 | `priceId` will be `null` for yearly plans — checkout session will fail. |
| InboxMessage table | 🟡 | Empty (0 rows). Old inbound webhook had payload parsing bug (reading `payload.to` instead of `payload.data.to`) — emails were received but silently skipped. Bug fixed in `3253f26`. **Tolt.io verification email was missed.** Request new code from Tolt dashboard. |

---

## Tolt.io Verification Code

The Tolt.io sign-up email was sent to `maks-5wl6@resumeai-bot.ru`. The inbound webhook was broken at the time (Svix envelope not unwrapped → empty "to" address → skipped). The email was NOT recorded in the `InboxMessage` table.

**Action required:** Go to [tolt.io](https://tolt.io) → click "Resend verification code." The new email will now be processed correctly (webhook fixed in `3253f26`). The code will appear in the `InboxMessage` DB table with `userId` = `maks-5wl6` user's ID.

To retrieve the code once resent:
```sql
SELECT "subject", "bodyText", "receivedAt"
FROM "InboxMessage"
WHERE "userId" = (SELECT id FROM "User" WHERE "inboxHandle" = 'maks-5wl6')
ORDER BY "receivedAt" DESC
LIMIT 5;
```
Run via: `ssh root@72.56.250.53 "docker exec resumeai-db psql -U resumeai -d resumeai -c \"<above query>\""`

---

## Recommended next prompts (in order)

1. **🔴 Fix docker-compose.yml** — Add `STRIPE_PRICE_ID_PRO_YEARLY`, `STRIPE_PRICE_ID_UNLIMITED_YEARLY`, `NEXT_PUBLIC_TOLT_REFERRAL_ID` to the web service `environment:` block. Then update VPS `.env` with values and restart web container. Annual plans and Tolt affiliate tracking are broken without this.

2. **🔴 Verify annual plan checkout** — After (1), test checkout with a yearly plan to confirm `priceId` is non-null and Stripe accepts it.

3. **🟡 Update ARCHITECTURE.md** — Add Chrome extension subsystem, referral system, annual billing, and change `middleware.ts` references to `proxy.ts`.

4. **🟡 Run DB backup drill** — `ssh root@... "bash /opt/resumeai/scripts/backup_db.sh"` then restore to a test DB and verify row counts match.

5. **🟡 Rotate NEXTAUTH_SECRET** — Before public launch. Generate: `openssl rand -base64 32`. Update VPS `.env` and all existing sessions will be invalidated (users re-login once — acceptable).

6. **🟡 Add `?connection_limit=5` to DATABASE_URL** — In `docker-compose.yml`. Prevents Prisma from opening 10 connections per container instance on scale.

7. **🟡 Add OpenRouter fallback** — In `worker/ai/resume.py`, catch `openai.APIConnectionError` and surface a user-friendly error or implement direct-API retry. Currently a hard failure if OpenRouter is down.

8. **🟡 `/privacy` date check** — Confirm `/privacy` shows a current date, not January 2024.

9. **🟡 OG preview test** — Run LinkedIn Post Inspector on `https://resumeai-bot.ru` before first paid marketing post.

---

## VPS Verification Block

```bash
# ── Production sync verification ─────────────────────────────────────────────
# Run on operator machine with SSH access to VPS.

# 1. All containers running
ssh root@72.56.250.53 "docker ps --format '{{.Names}}: {{.Status}}'"
# Expected: 7 containers, all Up/healthy

# 2. Web image on latest SHA
ssh root@72.56.250.53 "docker inspect resumeai-web --format '{{.Config.Image}}'"
# Expected: ghcr.io/maksimabramov105-dotcom/resumeai-web:3253f26...

# 3. No errors in web logs (last 10 min)
ssh root@72.56.250.53 "docker logs resumeai-web --since=10m 2>&1 | grep -i error | grep -v AutoApplyCampaign"
# Expected: empty (AutoApplyCampaign errors now gone with 3253f26 image)

# 4. Public site 200
curl -sf -o /dev/null -w "%{http_code}" https://resumeai-bot.ru/
# Expected: 200

# 5. Worker health
curl -sf -o /dev/null -w "%{http_code}" https://resumeai-bot.ru/api/worker/health
# Expected: 200

# 6. Auth endpoint
curl -s https://resumeai-bot.ru/api/auth/providers | python3 -c "import json,sys; print(list(json.load(sys.stdin).keys()))"
# Expected: ['google', 'github', 'email']
```

**Audit result at time of writing:**

```
✅ 7 containers: all Up/healthy
✅ Web image: 3253f26 (latest)
✅ No new errors in web logs
✅ https://resumeai-bot.ru → 200
✅ /api/worker/health → 200
✅ Auth providers: google, github, email

🔴 2 RED items must be resolved before paid marketing:
   1. Annual Stripe price IDs missing from docker-compose.yml web env
   2. NEXT_PUBLIC_TOLT_REFERRAL_ID missing from docker-compose.yml web env

STATUS: PASS for basic availability / BLOCKED for annual plans + affiliate tracking
```
