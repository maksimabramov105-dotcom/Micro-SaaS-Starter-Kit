# Prompt 23 (PR #6) Production Landing Audit — 2026-05-16

Audited by: Claude Code (Prompt 26)  
VPS: root@72.56.250.53  
Repo: maksimabramov105-dotcom/Micro-SaaS-Starter-Kit  
Running container image: `55a93dae14827efb6c8f065aa8c36dd75021778f`

---

## Summary

PMF system from PR #6 **IS fully in production** after three config gaps were fixed this session.  
All automated checks pass. Three steps require manual browser/Stripe verification (see TODO).

---

## TODO — Manual Actions Required

| # | Action |
|---|--------|
| 3b | Sign in as `maksimabramov105@gmail.com` → `/admin/pmf` → verify all 12 tiles render (values may be 0) |
| 3c | Sign in as a different Google account → `/admin/pmf` → must redirect to `/dashboard` |
| 6b | Stripe Dashboard (TEST mode) → create test subscription → confirm `checkout.session.completed` delivers 200 → query DB: `firstPaidAt` MUST be set |
| 6c | Stripe Dashboard (TEST mode) → cancel that subscription → confirm `customer.subscription.deleted` delivers 200 → query DB: `cancelledAt` MUST be set |
| 7 | Sign in as a paying user → `/dashboard/billing` → Cancel subscription → pick a reason → query DB: `refundReason` MUST equal the chosen value |

**Follow-up items (GitHub Issues disabled — track manually):**
- **8a** `lib/pmf/queries.ts::getReferralMetrics()` is a stub returning `null/0`. Needs real referral tracking: add `referredBy` to `User` schema, track at signup, query at runtime.
- **8b** `SurveyModal` dismiss only blocks per-session, not 24h. Spec: reopen after 24h if dismissed without answering. Fix: add `dismissedAt` tracking, update `getPendingSurvey()`.

**Structural code gap (requires separate prompt — FORBIDDEN to fix here):**
- The deploy script injects `WEB_IMAGE` as a shell env var but never persists it to `.env`. Every manual `docker compose up -d` restart reverts the container to whatever `WEB_IMAGE` is hardcoded in `.env`. Fixed manually this session by updating `.env` to `55a93dae`. The deploy script should `sed -i` update `.env` on each successful deploy.

---

## Audit Results

| Step | Check | Result | Action taken |
|------|-------|--------|--------------|
| 0a | PR #6 merged | ✅ | merged_at: 2026-05-15T20:31:28Z, SHA 4c7638b9 |
| 0b | VPS on current code | ✅ | Container running 55a93dae (corrected from stale 75cbb9da) |
| 1a | Migration up-to-date | ✅ | `20260515120000_pmf_survey` is latest; confirmed via `_prisma_migrations` table |
| 1b | Survey table exists | ✅ | 7 columns: id, userId, type, scheduledFor, shownAt, answeredAt, response |
| 1b | User.firstPaidAt / cancelledAt / refundReason | ✅ | All 3 columns present with correct indices |
| 2a | ADMIN_EMAILS on VPS | ✅ (was MISSING) | Added `maksimabramov105@gmail.com` to `.env` + override file |
| 2b | CRON_SECRET on VPS | ✅ (was MISSING) | Generated `openssl rand -hex 32`, added to `.env` + override file |
| 2d | CRON_SECRET in GitHub Actions | ✅ (was MISSING) | Uploaded via REST API (HTTP 201) |
| 3a | /admin/pmf unauthenticated → not 404/500 | ✅ | `307 Location: /dashboard` |
| 3b | /admin/pmf renders all 12 tiles for admin | ⚠️ MANUAL | Route confirmed in `.next/app-path-routes-manifest.json`; browser login required |
| 3c | /admin/pmf blocks non-admin | ⚠️ MANUAL | Code: `isAdminEmail()` check → `redirect('/dashboard')` verified; browser test needed |
| 4 | Survey row created by cron for eligible user | ✅ | Synthetic test: backdated `firstPaidAt`, POST /api/cron/seed-surveys → `{"seeded":1,"eligible":1}`, Survey row confirmed in DB, cleaned up |
| 5a | seed-surveys workflow active | ✅ | GitHub Actions: "Seed daily surveys" state=active |
| 5b | Manual cron trigger succeeded | ✅ | HTTP 200 `{"seeded":1}` with correct CRON_SECRET |
| 5c | Cron logs | ⚠️ | Next.js standalone has no stdout grep; endpoint response confirms success |
| 6a | Test user DB baseline | ✅ | `firstPaidAt=null`, `cancelledAt=null` pre-test confirmed |
| 6b | `checkout.session.completed` → `firstPaidAt` | ⚠️ MANUAL | Code verified: idempotent guard on line 58 of webhook handler. Live key is sk_live — Stripe test mode required |
| 6c | `customer.subscription.deleted` → `cancelledAt` | ⚠️ MANUAL | Code verified: `cancelledAt: new Date()` on line 107. Stripe test mode required |
| 7a/b | Cancel dialog renders with 6 reasons | ✅ (code) | `EXIT_REASONS` has exactly 6 options per spec; billing page renders dialog |
| 7c/d | Exit reason captured in DB | ⚠️ MANUAL | Cancel API (`/api/stripe/cancel`) sets `refundReason` + `cancelledAt` — code verified; needs paying user session to execute |
| 8a | Referral tracking stub | ⚠️ DOC | Issues disabled; tracked in this report. `getReferralMetrics()` returns null/0 stubs |
| 8b | Survey 24h reopen | ⚠️ DOC | Issues disabled; tracked in this report. Dismiss blocks per-session only |

---

## Root Cause: VPS Was Running Stale Image (75cbb9da)

**What happened:** The deploy script injects `WEB_IMAGE=$GITHUB_SHA` as a shell env var but never writes it back to `.env`. The `.env` hardcoded `WEB_IMAGE=75cbb9da` (pre-PR-#6). Every `docker compose up -d` restart (e.g. to pick up new env vars this session) reverted to the old image.

**Symptom:** `/admin/pmf` returned 404 because the route didn't exist in the stale `75cbb9da` build.

**Fix applied this session:**
```bash
sed -i 's|WEB_IMAGE=.*|WEB_IMAGE=ghcr.io/.../resumeai-web:55a93dae...|' /opt/resumeai/.env
docker compose pull web && docker compose up -d --remove-orphans --no-build
```

**Verification:** `docker inspect resumeai-web --format "{{.Config.Image}}"` now shows `55a93dae`.

---

## All Config Actions Taken This Session (no code changes)

| # | Action | Location |
|---|--------|----------|
| 1 | Added `ADMIN_EMAILS=maksimabramov105@gmail.com` | `/opt/resumeai/.env` |
| 2 | Generated + added `CRON_SECRET` (64-char hex) | `/opt/resumeai/.env` |
| 3 | Created `docker-compose.override.yml` to forward `ADMIN_EMAILS`, `CRON_SECRET`, `NEXT_PUBLIC_APP_NAME` | `/opt/resumeai/docker-compose.override.yml` |
| 4 | Uploaded `CRON_SECRET` to GitHub Actions secrets | GitHub REST API (HTTP 201) |
| 5 | Updated `WEB_IMAGE` and `WORKER_IMAGE` to `55a93dae` | `/opt/resumeai/.env` |
| 6 | Pulled correct image + restarted web container | VPS docker compose |

---

## L1–L7 Production Landing Protocol

| Check | Result | Detail |
|-------|--------|--------|
| L1 PR #6 merged | ✅ | 2026-05-15T20:31:28Z, SHA 4c7638b9 |
| L2 git sync | ⚠️ N/A | VPS uses Docker-pull deploy; container SHA is source of truth |
| L3 container image | ✅ | web: `55a93dae` (corrected from stale `75cbb9da`) |
| L4 migrations | ✅ | `20260515120000_pmf_survey` applied; no new migrations in P26 |
| L5 env vars (ADMIN_EMAILS, CRON_SECRET) | ✅ | Both SET — added this session |
| L6 routes | ✅ | `/admin/pmf` → 307; `/api/cron/seed-surveys` → 401 unauth (correct) |
| L7a /admin/pmf unauth redirect | ✅ | 307 → `/dashboard` (not 404) |
| L7b seed-surveys cron | ✅ | HTTP 200 `{"seeded":1}` during synthetic test |
| L7c DB schema | ✅ | Survey table + 3 User columns confirmed in psql |
| L7d Stripe webhook reachable | ✅ | 400 for unsigned request (signature check working) |
| L7e Code: firstPaidAt/cancelledAt/refundReason | ✅ | All 3 write paths verified in webhook + cancel handlers |
| L7f Manual steps pending | ⚠️ | Steps 3b/3c/6b/6c/7 require browser + Stripe Dashboard TEST mode |
| Regression: tab title | ✅ | `<title>ResumeAI</title>` on live site (P25 fix intact) |
| Regression: /dashboard redirect | ✅ | `307 Location: /login` (P25 fix intact) |
