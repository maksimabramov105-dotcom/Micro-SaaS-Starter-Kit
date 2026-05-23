# Prompt 01 — Full system audit + GitHub ↔ VPS ↔ Production sync check

> **Paste this into Claude Code at the root of `Micro-SaaS-Starter-Kit`. Do NOT modify any code in this prompt — this is read-only audit.**
>
> 🚨 **VPS hard-fail:** end with the verification block from `docs/strategy/prompts/_VPS_VERIFICATION.md`. If you cannot SSH to the VPS in your environment, the audit is incomplete — paste the SSH-required commands into the audit report for the operator to run.

## Your role
You are a senior SRE doing a pre-marketing audit of ResumeAI Bot. The repo is `Micro-SaaS-Starter-Kit`, live at `https://resumeai-bot.ru`, deployed to VPS `root@resumeai-bot.ru` (also `72.56.250.53`) at `/opt/resumeai`. Goal: produce a written **sync report** so we know what's drifting before we ship anything.

**You will not edit code in this audit pass. You will read, verify, and write a report.**

## Read these first, in order
1. `docs/ARCHITECTURE.md` — understand the 9 subsystems
2. `docs/qa/launch_readiness_2026-05.md` — see what's already been QA'd
3. `docs/runbooks/deploy.md` — understand the deploy flow
4. `docs/legacy-audit.md` — context on what was removed
5. `docker-compose.yml` — current production container layout
6. `.github/workflows/deploy.yml` — what CI actually deploys
7. `.env.example` — what env vars production expects
8. `prisma/schema.prisma` — current DB schema
9. `package.json` and `worker/pyproject.toml` (or requirements) — current deps

## Audit checklist — produce findings for each

### A. GitHub ↔ VPS sync
- `git log --oneline -5` on local — what's the local HEAD?
- SSH to `root@resumeai-bot.ru`, `cd /opt/resumeai`, `git log --oneline -5` — what's the VPS HEAD? Do they match?
- Check `docker-compose ps` on VPS — all 6 containers up? Any in restart loop?
- Check `docker-compose logs --tail=200` for each container — any persistent errors?
- Pull the running image SHAs from `docker inspect` and compare against GHCR tags pushed by the latest workflow run.

### B. Architecture doc vs reality
Per the strategic analysis, the architecture doc is known to be missing four live subsystems. Verify each and confirm whether it actually exists in code:
- **Chrome extension** — does `extension/` exist? `manifest.json` version? Is it documented anywhere?
- **OpenRouter proxy** — search worker for `openai_base_url` / `OPENROUTER`. Where is the proxy URL configured? Is it the VPS or external?
- **PDF download endpoint** — does `app/api/resumes/[id]/pdf/route.ts` (or similar) exist? Does it call the worker? Worker route?
- **`STRIPE_PRICE_ID_TRIAL`** — search for this env var. Is there a corresponding plan in `lib/pricing.ts` (`PRICING_PLANS`)? If not, is the env var dead?

### C. Dead code / migration debt
- `hh.ru` columns in `prisma/schema.prisma`: `hhToken`, `hhResumeId`. Verify they're unused. `grep -ri "hhToken\|hhResumeId" --include="*.ts" --include="*.tsx" --include="*.py"` — only schema hits?
- Any other dead columns or models? Search for `@deprecated`, `// TODO remove`, `# legacy`.
- Sentry: search for `SENTRY_DSN` — code present, env var set? In prod?

### D. Stripe live mode sanity
- `lib/stripe.ts` — verify `maxNetworkRetries: 3` is still set (commit `2295262`).
- Confirm webhook endpoint `app/api/stripe/webhook/route.ts` validates `STRIPE_WEBHOOK_SECRET`.
- Confirm idempotency: re-delivering the same event ID should NOT double-credit. Look for an `idempotency_key` or DB-level dedupe (e.g., a `processed_stripe_events` table or unique-by-event-id constraint). **Flag if missing.**
- Refund route `app/api/billing/refund/route.ts` — does it actually call `stripe.refunds.create`? Does it send a confirmation email via `lib/billing/email-refund-confirmation.ts`? Test coverage on these files?

### E. Worker health
- `worker/worker/routes/jobs.py` — is the job store in-memory (dict)? Confirm. This is documented tech debt and must be flagged loudly.
- Does the worker call `openai_base_url` from `config.py`? If OpenRouter goes down, what happens? Fallback?
- PDF generation: which library is in use (reportlab? weasyprint?). Confirm.

### F. Notifier health
- `notifier/main.py` — Redis subscriber running? `REDIS_URL` env var set? Any rate-limit logic?
- Telegram bot token in env? Confirm not committed.

### G. Auth health
- NextAuth config in `lib/auth.ts` — Google, GitHub, Email providers all configured?
- `NEXTAUTH_URL` matches production URL (no localhost leak)?
- `NEXTAUTH_SECRET` rotated recently? (If unknown, flag for rotation pre-launch.)
- `ENCRYPTION_KEY` set in web container? (Per commit `e28b366` this was a past issue.)

### H. Legal / compliance / marketing readiness
- `/terms` and `/privacy` pages — are dates current or still January 2024?
- `sitemap.xml` — all 8 routes present and 200ing?
- `robots.txt` — blocks `/dashboard/`, `/api/`, `/admin/` confirmed?
- OG meta tags on root page — `og:title`, `og:image`, `og:url`, `twitter:card`?

### I. Database
- Connection pool size in `prisma/schema.prisma` or env? `?connection_limit=` in `DATABASE_URL`?
- Any pending migrations? `npx prisma migrate status`
- DB size / row counts on major tables (`User`, `Resume`, `JobApplication`, `AnalyticsEvent`, `ActivityLog`)?

### J. Live smoke test (read-only)
- `curl -sI https://resumeai-bot.ru` — 200?
- `curl -sI https://resumeai-bot.ru/api/health` (if exists) — 200?
- `curl -sI https://resumeai-bot.ru/pricing` — 200, contains real Stripe price IDs?
- Login flow — Google OAuth still works? (Manual check OK.)

## Output format

Write your findings to a NEW file: `docs/audits/sync-audit-YYYY-MM-DD.md` (use today's date).

Use this structure:

```
# Sync Audit — <date>

## TL;DR
- GREEN: <count> items
- YELLOW: <count> items (act this week)
- RED: <count> items (act before any paid marketing)

## A. GitHub ↔ VPS sync
| Item | Status | Detail |
|------|--------|--------|

## B. Architecture doc vs reality
(same table format)

## C. Dead code / migration debt
...

## D. Stripe
...

(etc through J)

## Recommended next prompts (in order)
1. ...
2. ...
```

## Rules
- **Do not modify any code or env files in this pass.**
- **Do not run any destructive command.** Read-only `git log`, `docker ps`, `curl`, `grep`, `cat`, `prisma migrate status` only.
- If you cannot SSH to the VPS (no credentials in environment), say so explicitly and skip VPS-only checks rather than guessing.
- If any check requires running code, write the command in the report under "Manual verification needed" — do not execute.
- When done, commit the new audit file with message `docs(audit): sync audit YYYY-MM-DD` and push.

## Definition of done
- `docs/audits/sync-audit-YYYY-MM-DD.md` exists, committed, pushed
- File contains a numbered count of GREEN/YELLOW/RED items
- Every RED item has a specific reproduction command and a recommended fix prompt
- You have NOT modified any other file in this pass
- VPS verification block (`docs/strategy/prompts/_VPS_VERIFICATION.md`) executed and PASS line copied into the audit file (or "operator handoff required" with the commands if SSH wasn't available)
