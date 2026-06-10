# ResumeAI — Full System Audit (pre-marketing)

**Date:** 2026-06-10 · **Auditor:** Claude Code (Prompt 09)
**Repo:** `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit` · **main HEAD:** `acefaec`
**Source of truth:** the code, not the docs. Constraints honored: single VPS + Docker Compose, Stripe-only, no new infra.

Legend: ✅ pass · ⚠️ needs attention / manual · ❌ fail · ⏳ needs prod (SSH) — listed at end.

---

## A. Code & CI health

| # | Check | Status | Detail |
|---|-------|--------|--------|
| A1 | `npm run lint` | ✅ | 0 errors, 0 warnings (`--max-warnings 0`) |
| A1 | `npm run build` | ✅ | Compiled successfully; `/contact` route added. Build-time `DATABASE_URL` prisma logs on `/admin/pmf` are the dynamic-page static probe — non-fatal, pre-existing |
| A1 | `npm run test:ci` (jest) | ✅ | **161 passed** / 14 suites (was 96 at last audit) |
| A1 | `pytest` (worker) | ✅ | **173 passed, 10 skipped**. Local venv needed `sentry-sdk` (present in prod image); installed for the run |
| A2 | `npm audit --audit-level=high` | ✅ | **0 high/critical**; 7 moderate (transitive `@sentry/webpack-plugin → uuid`). Baseline was 5 moderate — no new HIGH |
| A2 | `bandit -r worker/` | ✅ | **0 HIGH** (matches launch_readiness baseline) |
| A3 | Deployed SHA == main | ⏳→✅ likely | Latest **successful deploy run = `acefaec`** = current main HEAD (`gh run list deploy.yml`). Confirm VPS image tag via SSH (below) |

## B. Prod config drift  (verified via SSH 2026-06-10)

| # | Check | Status | Detail |
|---|-------|--------|--------|
| B1 | `RESUME_QUALITY_V2=true` in `/opt/resumeai/.env` + worker restarted | ✅ | **`RESUME_QUALITY_V2=true` confirmed**; worker started 2026-06-10T10:44 (after flag present). Quality pipeline is ON |
| B2 | `STRIPE_WEBHOOK_SECRET` / `CRON_SECRET` / `WORKER_SECRET` / `RESEND_API_KEY` / `NEXTAUTH_SECRET` / `ENCRYPTION_KEY` / `INBOX_DOMAIN` set + non-default | ✅ | All present + non-default (masked). Resend inbound MX: local `dig` blocked, but inbound replies are arriving + classified → MX functional |
| B3 | `jobfit_min_score` flag value | ✅ | enabled=true, **rolloutPct=65** (confirmed in prod DB) |
| B4 | `run-campaigns.yml` ran < 24h | ✅ | 4 successful runs in last 24h: 12:44, 09:05, 05:02, 00:19 (`gh run list`) |

## A3 (resolved)
✅ VPS images `resumeai-web` + `resumeai-worker` both tagged `acefaec…` = current main HEAD. Deployed == main.

## C. Funnel instrumentation

| # | Check | Status | Detail |
|---|-------|--------|--------|
| C | Single-query funnel (signups → resume → campaign → SUBMITTED → replies-by-class → subscribers → MRR) | ✅ built | Added `scripts/funnel_report.ts` (run `npx tsx scripts/funnel_report.ts`) + `getFunnelReport()` in [lib/pmf/queries.ts](../../lib/pmf/queries.ts) + a "Funnel (last 30 days)" row on [app/admin/pmf/page.tsx](../../app/admin/pmf/page.tsx). Run against prod via SSH to populate numbers |

## D. Money path

| # | Check | Status | Detail |
|---|-------|--------|--------|
| D1 | checkout → webhook → subscription → quota | ✅ (1 fix) | See failure modes below. **Fixed in-session:** webhook idempotency ordering |
| D2 | Refund flow honest vs 30-day promise | ✅ | [app/api/billing/refund/route.ts](../../app/api/billing/refund/route.ts) enforces exactly 30 days from `firstPaidAt` ([lib/billing/refund.ts:46](../../lib/billing/refund.ts)) — matches pricing-page promise ([app/pricing/page.tsx:79](../../app/pricing/page.tsx)). Refund → cancel sub → downgrade to free → email |

**D1 failure modes (every one that could give paid users no service / free users paid service):**
1. ❌→✅ **FIXED** — `app/api/webhooks/stripe/route.ts`: the idempotency row (`stripeEvent.create`) was written *before* the handler ran. A transient error mid-handler (`subscriptions.retrieve` / `user.update`) left the event marked processed, so Stripe's retry was skipped and the **paying user's subscription was never recorded → no service**. Moved the record to *after* successful processing (try/caught for the rare concurrent double-delivery).
2. ⚠️ low-risk — `invoice.payment_failed` only logs + emails; it does **not** downgrade. A delinquent user keeps paid limits during Stripe's ~1-week dunning until `customer.subscription.deleted` fires. Standard SaaS grace period; acceptable.
3. ℹ️ by design — free tier = **3 apps/day** (`lib/pricing.ts`), so free users get limited service intentionally.
4. ✅ **"free user gets paid service" is prevented** — `run-campaigns` caps each run at `min(campaign.dailyLimit, live user remaining)` using `user.dailyApplicationLimit`, which the webhook downgrades to free on cancel/refund ([route.ts:773](../../app/api/cron/run-campaigns/route.ts), [lib/quota.ts:22](../../lib/quota.ts)). A stale campaign limit can't exceed the live user tier.

## E. Legal minimum

| Item | Status | Detail |
|------|--------|--------|
| Terms exists + linked | ✅ | Footer + `/login`. **Added clause 2a "Automated Application Submission"** (authorization, user responsible for accuracy, no guarantee) |
| Privacy exists + linked | ✅ | **Added:** resumes/contact/screening + stored recruiter emails to §1; employers/ATS sharing + new §3a auto-submission; GDPR/CCPA + self-serve deletion in §5 |
| Contact / impressum | ✅ **created** | New `app/contact/page.tsx` (support, privacy/data requests, billing) + footer link now `/contact` + added to sitemap |
| Mentions: auto-submission on behalf · data stored (resumes, emails) · Stripe · GDPR deletion | ✅ | All now present across Terms 2a + Privacy §1/§3/§3a/§5 |

## F. Deliverables

- ✅ This file — `docs/audits/full-audit-2026-06-10.md`
- ✅ `docs/SUBSYSTEMS.md` — 9-subsystem index
- ✅ In-session fixes: webhook idempotency ordering; Privacy + Terms disclosures; new `/contact` page; `funnel_report.ts` + PMF funnel row

---

## ⏳ Needs you to run on the VPS (or approve me running SSH)

```bash
# A3 — confirm deployed image == main acefaec
ssh root@178.105.185.214 'docker ps --format "{{.Names}} {{.Image}}" | grep resumeai'
# B1 — CRITICAL: quality pipeline flag (off = generic resumes for everyone)
ssh root@178.105.185.214 'grep RESUME_QUALITY_V2 /opt/resumeai/.env; docker inspect resumeai-worker --format "{{.State.StartedAt}}"'
# B2 — secrets present & non-default (masked)
ssh root@178.105.185.214 'grep -E "^(STRIPE_WEBHOOK_SECRET|CRON_SECRET|WORKER_SECRET|RESEND_API_KEY|INBOX_DOMAIN)=" /opt/resumeai/.env | sed -E "s/=(.{0,6}).*/=\\1…/"'
# B3 — jobfit threshold
ssh root@178.105.185.214 'docker exec -i resumeai-db psql -U resumeai -d resumeai -tc "SELECT key,enabled,\"rolloutPct\" FROM \"FeatureFlag\" WHERE key='"'"'jobfit_min_score'"'"';"'
# C — funnel numbers from prod
ssh root@178.105.185.214 'docker exec -i resumeai-web npx tsx scripts/funnel_report.ts'
# B2 — Resend inbound MX (from anywhere)
dig +short MX inbox.resumeai-bot.ru
```

## TODO (larger than this session)

| Item | Effort | Why |
|------|--------|-----|
| Sentry monitoring (no account) — carried from May audit | ~1h | Error visibility before traffic |
| DB restore drill (`scripts/backup_db.sh`) | ~1h | Untested restore before real user data |
| Required-LinkedIn-field handling (some Greenhouse forms require a LinkedIn URL the candidate lacks) | ~3h | Small subset of apply failures |
| 70% test-coverage target (email/digest/crypto/linkedin gaps) | ~1d | Pre-scale hardening |
