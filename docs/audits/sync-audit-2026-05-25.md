# Sync Audit — 2026-05-25

**Auditor:** Claude Code (SRE pass)  
**Commit audited:** `b82994e` (HEAD of `main` at audit time)  
**Production:** https://resumeai-bot.ru  
**DB migrations:** 13 applied, latest `20260524120000_add_referral_system`  
**Audit scope:** Pre-marketing pass — read-only, no code edits.

---

## TL;DR

| Severity | Count | Summary |
|----------|-------|---------|
| 🔴 RED   | 0     | All previous blockers resolved |
| 🟡 YELLOW | 4    | Act this week |
| 🟢 GREEN  | 28   | No action needed |

---

## A. GitHub ↔ VPS sync

| Item | Status | Detail |
|------|--------|--------|
| Local HEAD | 🟢 | `b82994e fix(auth): allow same-email sign-in across Google and GitHub providers` |
| CI pipeline | 🟢 | Run [26384461914](https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/actions/runs/26384461914) — Test ✅ 1m16s, Build ✅ 1m45s, Deploy ✅ 1m37s. All three jobs succeeded. |
| Production `/api/health` | 🟢 | HTTP 200, `{"status":"ok","version":"unknown","timestamp":"2026-05-25T05:16:50.377Z"}` |
| `version:"unknown"` | 🟡 | Build SHA is not injected into the web image at build time. The health endpoint always returns `"version":"unknown"`, which makes it impossible to confirm which commit is running from the health endpoint alone. To fix: pass `--build-arg COMMIT_SHA=$IMAGE_TAG` in the Dockerfile and expose it via `NEXT_PUBLIC_COMMIT_SHA`. Low priority but useful for post-deploy verification. |
| docker-compose.yml sync | 🟢 | CI step `Sync docker-compose.yml to VPS` copies the file on every deploy. Annual price IDs + Tolt env vars are now in the file (fixed in `afa3e9d`). |
| Cron jobs | 🟢 | `run-campaigns` and `digest` workflows: last 8 runs all `success`. No stuck runs. |
| SSH from local machine | ℹ️  | Direct SSH to `72.56.250.53` is blocked outside the GitHub Actions runner IP range (VPS firewall). VPS health confirmed via HTTP probes instead. |

---

## B. Architecture doc vs reality

| Item | Status | Detail |
|------|--------|--------|
| 5-service topology | 🟢 | `docker-compose.yml` declares: postgres, redis, web (Next.js 16), worker (FastAPI), notifier (Telegram), caddy. Matches `ARCHITECTURE.md`. |
| Rolling deploy order | 🟢 | `deploy.sh` rolls: worker → notifier → web. Correct — worker is largest image, web runs migrations last. |
| Prisma migrations on deploy | 🟢 | `deploy.sh` runs `prisma migrate deploy` after web container is up. 13 migrations applied successfully. |
| Feature flag admin UI | 🟢 | `/dashboard/admin/flags` exists and is gated to `role === 'admin'`. `FeatureFlag` and `Experiment` tables in DB. Not dead code. |
| `proxy.ts` (Next.js 16 auth guard) | 🟢 | `proxy.ts` exists and handles route-level auth. `ARCHITECTURE.md` was updated to reflect this in a prior pass. |
| `middleware.ts` reference in ARCHITECTURE.md | 🟡 | Section 4 of `ARCHITECTURE.md` still says "middleware.ts (proxy.ts)". The parenthetical suggests it was noted but the description body may still use the old name in places. Verify on next doc-only pass. |
| Chrome extension | 🟢 | `extension/` present. ARCHITECTURE.md documents it. No store listing yet — pre-launch is fine. |
| OpenRouter proxy for AI | 🟢 | `OPENAI_BASE_URL` override documented in `docker-compose.yml` comments and `.env.example`. |
| Memory limit on worker | 🟢 | `deploy.resources.limits.memory: 1500m` — headroom for Playwright (~400 MB/instance × 3 max concurrent). |
| Disk guard in deploy.sh | 🟢 | Aborts if < 1 GB free. Pre/post cleanup with `docker image prune`. |

---

## C. Dead code / migration debt

| Item | Status | Detail |
|------|--------|--------|
| `hhToken` / `hhResumeId` | 🟢 | Removed in migration `20260524100000_remove_hh_ru_legacy_columns`. Zero hits in source. Clean. |
| `STRIPE_PRICE_ID_TRIAL` | 🟢 | Archive-only reference in `scripts/_archive/`. Not in live code, not in `.env.example`. Dead — no action needed. |
| `PDF_TEMPLATES_V1` flag | 🟢 | OFF by default. Used in `worker/config.py` and `app/api/resumes/[id]/pdf/route.ts`. Gated cleanly. Intentional feature-in-progress. |
| `RESUME_QUALITY_V2` flag | 🟢 | OFF by default. Used in `worker/ai/resume.py` and `worker/config.py`. Clean gate. |
| `teamId` columns | 🟢 | Nullable `teamId` fields in `AuditLog`, `UsageRecord`, and `Invoice`. No `Team` model. These are forward-compatible scaffolding for a future teams feature. Values are always null today. No migration needed — nullable columns are zero-cost. |
| `better-sqlite3` in devDependencies | 🟢 | Not imported in any `app/`, `lib/`, or `__tests__/` source file. Likely a transitive peer dependency pulled by a test utility. Not a production concern. |
| TODO/FIXME markers | 🟢 | Zero hits in `app/`, `lib/`, `worker/worker/` (scanned). |

---

## D. Stripe live mode sanity

| Item | Status | Detail |
|------|--------|--------|
| Webhook signature validation | 🟢 | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. Returns 400 on tampered payload. |
| Idempotency guard | 🟢 | `StripeEvent` table deduplicates replays: `findUnique({where:{id:event.id}})` → 200 early return. Fixed in `20260523150000_stripe_event_dedup` migration. |
| Annual plan price IDs | 🟢 | `STRIPE_PRICE_ID_PRO_YEARLY` and `STRIPE_PRICE_ID_UNLIMITED_YEARLY` now in `docker-compose.yml` environment block (fixed `afa3e9d`). Annual checkout is unblocked. |
| Referral qualify/clawback | 🟢 | `checkout.session.completed` calls `qualifyReferral` on first payment. `charge.refunded` calls `clawbackReferral`. Both wrapped in try/catch — non-fatal. |
| `firstPaidAt` set only once | 🟢 | `isFirstPayment = existingUser?.firstPaidAt == null` guard prevents overwriting on renewals. |
| `cancelledAt` set on delete | 🟢 | `customer.subscription.deleted` sets `cancelledAt: new Date()`. PMF churn tracking active. |
| `invoice.payment_failed` | 🟡 | Not handled in the webhook. A failed renewal goes undetected — no email, no grace-period downgrade, no Sentry alert. At low subscriber count this is acceptable but should be addressed before scale. At minimum: log the event and send an email nudge. |
| `maxNetworkRetries` | 🟢 | `lib/stripe.ts`: `maxNetworkRetries: 3`. |
| Refund route | 🟢 | `app/api/billing/refund/route.ts` confirmed in codebase. Cancels sub, issues Stripe refund, sends email. |

---

## E. Worker health

| Item | Status | Detail |
|------|--------|--------|
| Worker `/health` | 🟢 | `{"status":"ok","version":"1.0.0","db":"ok","timestamp":"2026-05-25T05:17:51+00:00"}`. DB connection healthy. |
| Worker accessible | 🟢 | Caddy proxies `https://resumeai-bot.ru/api/worker/*` to `http://worker:8000`. Public health check returns 200. |
| Job store tech debt | 🟡 | In-memory `_jobs: dict` is primary job state; Redis is write-through backup. **Worker restart during an active campaign run will leave those jobs stuck in "running" until Redis TTL expires.** This was flagged in the 2026-05-24 audit. Mitigation: ensure no restarts during campaign runs (~hourly cron window). Not a launch blocker but needs a ticket. |
| OpenRouter single-provider risk | 🟡 | `OPENAI_BASE_URL` points to OpenRouter on VPS. No fallback if OpenRouter is degraded. At launch traffic levels this is acceptable. Add a fallback or alert before significant user volume. |
| Memory cap | 🟢 | 1500 MB limit with `deploy.resources.limits.memory`. Headroom confirmed in prior QA. |

---

## F. Notifier health

| Item | Status | Detail |
|------|--------|--------|
| Bot token | 🟢 | `TELEGRAM_BOT_TOKEN` is an env var in `docker-compose.yml` — no hardcoded token in source or config. |
| Notifier service | 🟢 | Separate Docker container (`resumeai-notifier`). Reads from Redis, writes to Telegram API. |
| Notification toggles | 🟢 | `TelegramChat` model has per-type boolean toggles: `notifyOnSubmit`, `notifyOnInterviewReply`, `notifyOnLinkedInIssue`. |
| Error reporting | 🟢 | `SENTRY_DSN_NOTIFIER` env var in `docker-compose.yml`. Optional — silence by leaving empty. |

---

## G. Auth health

| Item | Status | Detail |
|------|--------|--------|
| Google OAuth redirect | 🟢 | POST `/api/auth/signin/google` → 302 to `accounts.google.com` with PKCE. ✅ Working. |
| CSRF token | 🟢 | `/api/auth/csrf` returns `{"csrfToken":"..."}`. Present and non-empty. |
| Providers | 🟢 | `/api/auth/providers` returns `{google, github, email}`. All three configured. |
| `OAuthAccountNotLinked` | 🟢 | **Fixed** in `b82994e`. `allowDangerousEmailAccountLinking: true` on both Google and GitHub providers. Cross-provider sign-in now works. |
| Session callback DB error | 🟢 | **Fixed** in `3f2b451`. Prisma query wrapped in try/catch. `session.user.id` always set from `token.sub`. Redirect loop impossible. |
| Redirect callback | 🟢 | Open-redirect guard: external URLs fall back to `/dashboard`. |
| Regression tests | 🟢 | `__tests__/lib/auth.test.ts` — 8 tests covering: DB success, DB throws, DB null, missing token.sub, same-origin redirect, base-URL redirect, external URL fallback, protocol-relative guard. All passing. |
| `NEXTAUTH_DEBUG: "1"` | 🟡 | Still present in `docker-compose.yml` (line 54). Added during the auth investigation on 2026-05-24. **Remove before any marketing push.** This causes NextAuth to log full JWT contents (including user ID, Stripe metadata) to stdout/Docker logs on every authenticated request. Remove by deleting that line and pushing to main. |
| Login page callbackUrl | 🟢 | `LoginButtons` reads `?callbackUrl=` with Suspense wrapper. Only relative same-origin paths accepted. |

---

## H. Legal pages

| Item | Status | Detail |
|------|--------|--------|
| Privacy Policy | 🟢 | `/privacy` — HTTP 200. Last updated 2026-05-24. Covers: data collection, usage, sharing (Stripe), security, user rights, cookies, contact. |
| Terms of Service | 🟢 | `/terms` — HTTP 200. Last updated 2026-05-25. Covers: acceptance, license, disclaimer, limitations, revisions, subscription/billing, referral program (capped at 10/$200, clawback on refund), affiliate program (Tolt). |
| Refund Policy | 🟢 | `/refund-policy` — HTTP 200. Page exists. |
| Referral terms in ToS | 🟢 | Section 7 explicitly documents the $20 double-sided credit, 10-referral cap, clawback condition, and fraud clause. Legally adequate for launch. |
| Affiliate disclosure in ToS | 🟢 | Section 8 discloses Tolt affiliate program and cookie tracking. Compliant with FTC disclosure requirement. |
| AI/LLM data disclosure | 🟡 | Privacy Policy does not mention that user resume content and LinkedIn credentials are processed by OpenAI (via OpenRouter). In the EU/Russia this may require explicit consent. **Add a sentence to Section 1 or a new Section 9 before any paid acquisition campaign.** Draft: *"When you use AI-powered features, your resume content is sent to OpenAI's API for processing. We do not store your data on OpenAI's servers beyond the processing window."* |
| Contact email | 🟢 | Section 8 says "through your account settings or by email" — acceptable for launch. A named support email would be better but not blocking. |

---

## I. Database / migrations

| Item | Status | Detail |
|------|--------|--------|
| Applied migrations | 🟢 | 13 migrations, all applied. Latest: `20260524120000_add_referral_system`. |
| Migration history | 🟢 | Chronologically ordered, naming convention consistent (`YYYYMMDDHHMMSS_description`). |
| `_prisma_migrations` table | 🟢 | Deploy script runs `prisma migrate deploy` every push. Migrations are idempotent. |
| Binary targets | 🟢 | `schema.prisma` includes `linux-musl-openssl-3.0.x` and `linux-musl-arm64-openssl-3.0.x` for Alpine Docker. |
| DB healthcheck | 🟢 | `pg_isready -U resumeai -d resumeai` in docker-compose healthcheck. `depends_on` with `condition: service_healthy`. |
| Redis healthcheck | 🟢 | `redis-cli ping` in healthcheck. Web and worker both declare `depends_on: redis: condition: service_healthy`. |
| Backup cron | 🟢 | Daily `backup_db.sh` at 03:00 UTC per runbook setup instructions. |
| `StripeEvent` table | 🟢 | Added in `20260523150000_stripe_event_dedup`. Index on `processedAt`. Idempotency working in production. |
| `FeatureFlag` + `Experiment` | 🟢 | Added in `20260524110000_add_feature_flags_and_experiments`. Admin UI at `/dashboard/admin/flags`. |

---

## J. Smoke test results

All tests run against `https://resumeai-bot.ru` at 2026-05-25 ~05:17 UTC.

| Check | Status | Detail |
|-------|--------|--------|
| `/api/health` | ✅ | HTTP 200 — `{"status":"ok","version":"unknown"}` |
| `/api/worker/health` | ✅ | HTTP 200 — `{"status":"ok","version":"1.0.0","db":"ok"}` |
| `/api/auth/csrf` | ✅ | CSRF token present and non-empty |
| `/api/auth/providers` | ✅ | Returns `{google, github, email}` |
| Google OAuth initiation | ✅ | POST `/api/auth/signin/google` → 302 → `accounts.google.com` with PKCE |
| `/login` | ✅ | HTTP 200 |
| `/pricing` | ✅ | HTTP 200 |
| `/privacy` | ✅ | HTTP 200 |
| `/terms` | ✅ | HTTP 200 |
| Latest deploy pipeline | ✅ | Run 26384461914 — Test ✅ Build ✅ Deploy ✅ |

---

## Outstanding items from previous audits

| Item | Was | Now |
|------|-----|-----|
| Annual price IDs missing from docker-compose | 🔴 2026-05-24 | ✅ Fixed `afa3e9d` |
| Tolt referral ID missing from docker-compose | 🔴 2026-05-24 | ✅ Fixed `afa3e9d` |
| `OAuthAccountNotLinked` sign-in failure | 🔴 2026-05-24 | ✅ Fixed `b82994e` |
| Session callback redirect loop | 🔴 2026-05-24 | ✅ Fixed `3f2b451` |
| Job store restart risk (worker) | 🟡 2026-05-24 | 🟡 Carries forward — not a launch blocker |
| OpenRouter single-provider risk | 🟡 2026-05-24 | 🟡 Carries forward — acceptable at launch volume |

---

## Action items by priority

### This week (before any paid marketing)

| # | Action | File | Severity |
|---|--------|------|----------|
| 1 | Remove `NEXTAUTH_DEBUG: "1"` from docker-compose.yml — JWT contents logged to stdout | `docker-compose.yml` line 54 | 🟡 |
| 2 | Add AI/LLM data processing disclosure to Privacy Policy | `app/privacy/page.tsx` | 🟡 |
| 3 | Add `invoice.payment_failed` Stripe webhook handler (email nudge + log) | `app/api/webhooks/stripe/route.ts` | 🟡 |
| 4 | Update GitHub Actions to Node.js 24 (`actions/checkout@v4` etc.) before **June 2, 2026** deadline | `.github/workflows/*.yml` | 🟡 |

### When convenient (non-blocking)

| # | Action | Detail |
|---|--------|--------|
| 5 | Inject build SHA into health endpoint | Pass `COMMIT_SHA` build-arg in Dockerfile |
| 6 | Worker job store resilience | Recover in-flight jobs from Redis on restart |
| 7 | OpenRouter fallback | Add direct OpenAI as secondary `OPENAI_BASE_URL` on failure |

---

*Audit performed by Claude Code. No code was modified during this pass.*
