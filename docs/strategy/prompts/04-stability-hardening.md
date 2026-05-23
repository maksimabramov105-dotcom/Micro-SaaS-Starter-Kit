# Prompt 04 — Stability hardening (Sentry, persistent worker store, hh.ru cleanup, legal dates, trial plan resolution)

> **Paste into Claude Code. This is a multi-fix prompt. Each fix is independent. Stop and ask if any are unclear before touching code.**
>
> ⚠️ **READ FIRST: `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.3.** Several corrections apply: (a) web Sentry is already wired — only sample rates need lowering, not full init; (b) Stripe webhook path is `app/api/webhooks/stripe/route.ts`; (c) `hh.ru` cleanup must also patch or delete `scripts/migrate-from-legacy.ts`; (d) `worker/worker/ai/tailor.py` has its OWN in-memory cache — give it the same Redis treatment as `routes/jobs.py`; (e) FAQ at `app/faq/page.tsx` promises a 14-day trial that doesn't exist — fix or remove; (f) `STRIPE_PRICE_ID_BASIC` and `STRIPE_PRICE_ID_ENTERPRISE` are also orphan env vars to clean up.
>
> 🚨 **VPS hard-fail:** end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why
Before paid marketing, these are the production-grade issues that will burn you:
1. **No Sentry DSN configured** — you're blind in production.
2. **In-memory worker job store** — single restart wipes in-flight autoapply jobs.
3. **`hh.ru` dead columns** — migration debt, will confuse future-you and any contractor.
4. **Legal dates say Jan 2024** — fails enterprise trust + reads as abandoned.
5. **`STRIPE_PRICE_ID_TRIAL` orphan env var** — either resolve or remove.

All five are small, all are independent, all are blocking marketing.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §1 and §5 — context + QA additional checks
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.3 — corrections for this prompt
3. `docs/ARCHITECTURE.md`
4. `docs/qa/launch_readiness_2026-05.md`
5. `docker-compose.yml` — current env + services (Redis already runs)
6. `prisma/schema.prisma` — find the `hh*` fields
7. `lib/pricing.ts` — `PRICING_PLANS` definitions
8. `worker/worker/routes/jobs.py` — in-memory `_jobs` dict (replace with Redis)
9. `worker/worker/ai/tailor.py` — in-memory `_CACHE` dict (SAME problem, also replace)
10. `worker/worker/config.py` — already has `redis_url`, reuse
11. `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — web is already wired; only sample rates need lowering
12. `app/api/webhooks/stripe/route.ts` — NOTE PATH (not `app/api/stripe/webhook/`)
13. `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/faq/page.tsx` — date sweep + trial claim
14. `scripts/migrate-from-legacy.ts` — references hh* fields; must update or delete during hh.ru cleanup

## Fix 1 — Sentry DSN connected end-to-end

### Step 1.1 — Create Sentry projects
**Manual step (you, before running this prompt):** Sign up for [Sentry free tier](https://sentry.io). Create THREE projects:
- `resumeai-web` (Next.js)
- `resumeai-worker` (Python/FastAPI)
- `resumeai-notifier` (Python/asyncio)

Grab the DSN from each project's Settings → Client Keys.

### Step 1.2 — Web (Next.js)
Verify or add `@sentry/nextjs` (latest version compatible with Next.js 16). Confirm `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` exist with `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, replaysSessionSampleRate: 0.05 })`. Confirm `instrumentation.ts` re-exports the appropriate config. If missing, run `npx @sentry/wizard@latest -i nextjs` and apply changes.

Add to `docker-compose.yml` web service env:
```
SENTRY_DSN=${SENTRY_DSN_WEB}
NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN_WEB}
```

### Step 1.3 — Worker (Python)
In `worker/pyproject.toml` add `sentry-sdk[fastapi]>=2.0.0`. In `worker/worker/main.py` (or wherever FastAPI app is created), add at top of module:
```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from .config import settings

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=0.1,
        environment=settings.environment,
        integrations=[FastApiIntegration()],
    )
```
Add to `worker/worker/config.py`:
```python
sentry_dsn: str | None = None
environment: str = "production"
```

### Step 1.4 — Notifier (Python)
In `notifier/requirements.txt` add `sentry-sdk>=2.0.0`. In `notifier/main.py`, init Sentry at startup (no integration needed — bare SDK is enough for an asyncio service).

### Step 1.5 — CI smoke test (deferred, but spec it)
Add a CI step in `.github/workflows/deploy.yml` that, AFTER deploy succeeds, hits `https://resumeai-bot.ru/api/_sentry-canary` (a new internal route guarded by a header secret) which throws a tracked exception. Verify the event appears in Sentry within 60s — fail the workflow if not. (Implement the route + workflow step but make the workflow step a soft-failure for now so you can verify it works before making it hard-fail.)

## Fix 2 — Persistent worker job store

Per `docs/strategy/STRATEGIC_ANALYSIS.md`, the in-memory dict in `worker/worker/routes/jobs.py` is HIGH severity. Replace with Redis.

### Step 2.1 — Confirm Redis is already a service in `docker-compose.yml` (it is — used by notifier). Reuse it.

### Step 2.2 — Add `redis>=5.0` to `worker/pyproject.toml`. Add `redis_url` to `worker/worker/config.py` (default `redis://redis:6379/1` — note **DB 1** so we don't collide with notifier's DB 0).

### Step 2.3 — Create `worker/worker/store.py`:
```python
"""Persistent job store backed by Redis. Replaces the previous in-memory dict."""
import json
import time
from typing import Any, Optional
import redis.asyncio as redis
from .config import settings

_client: Optional[redis.Redis] = None

def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client

KEY_PREFIX = "resumeai:job:"
TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days

async def set_job(job_id: str, data: dict[str, Any]) -> None:
    r = get_redis()
    await r.set(f"{KEY_PREFIX}{job_id}", json.dumps(data), ex=TTL_SECONDS)

async def get_job(job_id: str) -> Optional[dict[str, Any]]:
    r = get_redis()
    raw = await r.get(f"{KEY_PREFIX}{job_id}")
    return json.loads(raw) if raw else None

async def delete_job(job_id: str) -> None:
    r = get_redis()
    await r.delete(f"{KEY_PREFIX}{job_id}")
```

### Step 2.4 — Replace EVERY use of the in-memory dict in `worker/worker/routes/jobs.py` with `await set_job(...)` / `await get_job(...)`. Keep the in-memory dict around for ONE release with a fallback read path (Redis miss → in-memory check), then remove in the next release.

### Step 2.5 — Tests
`worker/tests/test_store.py`:
- Set/get/delete round-trip
- TTL works
- Connection error returns sensible fallback (None on get)

## Fix 3 — Remove `hh.ru` dead columns

### Step 3.1 — Verify dead. Run:
```bash
grep -rni "hhToken\|hhResumeId\|hh\.ru" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.prisma" .
```
Expected: only schema hits. If any code reference exists, **stop and ask** — do not assume.

### Step 3.2 — Migration:
```bash
npx prisma migrate dev --name remove_hh_ru_legacy_columns
```
In the migration, drop `hhToken` and `hhResumeId` from the relevant model in `prisma/schema.prisma`. Verify the generated SQL is `ALTER TABLE ... DROP COLUMN ...`.

### Step 3.3 — Apply to prod with caution:
- Take a DB dump first: `pg_dump $DATABASE_URL > backup_pre_hh_cleanup_$(date +%Y%m%d).sql`
- Run `npx prisma migrate deploy` on VPS
- Verify no errors in app logs after migration

## Fix 4 — Legal date sweep

### Step 4.1 — Update `/terms` and `/privacy` to display "Last updated: [today's date]". Convert to dynamic display:

In `app/terms/page.tsx` and `app/privacy/page.tsx`:
```tsx
const LAST_UPDATED = new Date('2026-05-21'); // BUMP ON ANY MEANINGFUL EDIT

// In JSX:
<p className="text-sm text-muted-foreground">
  Last updated: {LAST_UPDATED.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
</p>
```

### Step 4.2 — Review the content itself. If any term references missing features (e.g., legacy Russian-market language), update. Keep edits minimal — wholesale rewrites need a lawyer.

### Step 4.3 — Add to QA checklist: "Update LAST_UPDATED on every meaningful policy edit."

## Fix 5 — Resolve `STRIPE_PRICE_ID_TRIAL`

### Step 5.1 — Decide: was a trial plan ever intended?
- If YES (recommended — see strategic doc on Sonara-style $1 trial): add a `trial` plan to `lib/pricing.ts`:
  ```typescript
  trial: {
    id: 'trial',
    name: '7-day Pro Trial',
    priceMonthly: 1,
    priceId: process.env.STRIPE_PRICE_ID_TRIAL!,
    appsPerDay: 25,
    features: ['Full Pro for 7 days', 'Auto-converts to Pro at $19.99/mo'],
    interval: '7day_trial',
  },
  ```
  Then implement the checkout flow that uses this price and creates a Stripe subscription with `trial_period_days: 7` and then transitions to the Pro price. Document in `docs/runbooks/trial-plan.md`.

- If NO: remove `STRIPE_PRICE_ID_TRIAL` from `.env.example`, `docker-compose.yml`, and any other env reference. Commit message must explain why removed.

**Default for this prompt: choose YES** — adding the trial is a directly revenue-positive change. But STOP and confirm with the user before creating the Stripe price.

## Verification (each fix)
| Fix | Verify |
|-----|--------|
| 1. Sentry | Trigger a test exception in each service, see it in Sentry dashboard within 60s |
| 2. Worker store | Restart worker container during a fake autoapply campaign — job survives |
| 3. hh.ru cleanup | App still starts, prisma client regenerates, no schema errors |
| 4. Legal dates | Visit `/terms` and `/privacy` — see today's date |
| 5. Trial plan | If chose YES: test checkout with the trial price in Stripe TEST mode first |

## Deploy
- Branch per fix: `fix/sentry`, `fix/worker-redis-store`, `chore/remove-hh-ru`, `chore/legal-dates`, `feat/trial-plan` (or `chore/remove-stripe-trial-env`)
- Merge in order: 4 → 3 → 1 → 2 → 5 (lowest risk to highest)
- After each merge: SSH to VPS, pull, `docker-compose up -d` only the affected service, verify in logs and Sentry
- DB backup before fix 3 is non-negotiable

## Rules
- Each fix is its own PR. Easier to revert individually.
- DB backup before any migration that drops columns.
- Sentry sample rates are intentionally low (0.1 traces, 0.05 replays) — don't blow through the free tier quota in week one.
- Do NOT add the trial plan to Stripe live mode until smoke-tested in test mode.
- Commit messages:
  - `feat(observability): wire Sentry across web, worker, notifier`
  - `feat(worker): persistent Redis job store (replaces in-memory)`
  - `chore(db): drop hh.ru legacy columns`
  - `chore(legal): update terms/privacy last-updated to today + dynamic display`
  - `feat(billing): add 7-day $1 trial plan` (or `chore(env): remove orphan STRIPE_PRICE_ID_TRIAL`)

## Definition of done
- All 5 fixes deployed independently
- Sentry dashboards show events from all 3 services
- Worker survives restart with in-flight job intact
- hh.ru columns gone from schema + DB
- `/terms` and `/privacy` show today's date
- Trial plan decision made and implemented
- VPS git HEAD matches GitHub main
- `docs/ARCHITECTURE.md` updated for: Sentry, Redis-backed worker store, trial plan (or removal)
- `docs/qa/launch_readiness_2026-05.md` updated: mark resolved items
