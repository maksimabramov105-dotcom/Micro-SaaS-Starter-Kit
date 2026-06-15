# Prompt 09 — Full System Audit Before Marketing Push

Copy everything below into Claude Code, run from `~/code/Micro-SaaS-Starter-Kit`.

---

You are auditing ResumeAI before a marketing launch. Read `docs/PROJECT_MAP_RU.md` and `docs/ARCHITECTURE.md` first. Source of truth is the code, not the docs. Hard constraints: single VPS + Docker Compose, Stripe-only billing, no new infrastructure.

## Scope — verify each item against reality, produce a written report

### A. Code & CI health
1. `npm run lint`, `npm run build`, `npm run test:ci`, `cd worker && pytest` — all must pass. Record counts.
2. `npm audit --audit-level=high` and `bandit -r worker/` — no new HIGH findings since `docs/qa/launch_readiness_2026-05.md`.
3. Confirm latest `main` commit is what is deployed on the VPS (compare git SHA in GHCR image tag via `ssh root@178.105.185.214 'docker ps --format "{{.Image}}"'` — ask me before running any SSH command).

### B. Prod config drift (ask me to run SSH commands, or use the deploy docs)
1. `/opt/resumeai/.env`: verify `RESUME_QUALITY_V2=true` is present and worker container restarted after it was added. **This is critical** — Prompt 02 shipped the quality pipeline behind this flag; if it is off, every application goes out with the old generic resume.
2. Verify Stripe webhook secret, Resend inbound domain (`inbox.resumeai-bot.ru` MX), CRON_SECRET, WORKER_SECRET all set and non-default.
3. Check feature flag `jobfit_min_score` value in prod DB and report it.
4. Verify the cron workflow `.github/workflows/run-campaigns.yml` ran successfully in the last 24h.

### C. Funnel instrumentation (the biggest audit gap)
Verify we can answer, from the prod DB, for the last 30 days:
- signups; users who created a resume; users who created a campaign; applications submitted (with `_verify_submitted=true`); inbound replies by class (INTERVIEW_REQUEST / REJECTION / QUESTION / AUTOMATED); paying subscribers; MRR.
If any of these cannot be answered with a single SQL query, create `scripts/funnel_report.ts` (or .sql) that prints this table, and add a row to the admin PMF page. No new services — plain Prisma queries.

### D. Money path
1. Trace checkout → webhook → subscription state → quota enforcement in code; list every failure mode that would let a paying user get no service or a free user get paid service.
2. Verify refund flow (`app/api/billing/refund`) works and is honest with the 30-day money-back promise on the pricing page.

### E. Legal minimum before marketing
Confirm ToS, Privacy Policy, and an impressum/contact page exist, are linked in the footer, and mention: automated application submission on user's behalf, data stored (resumes, emails), Stripe processing, GDPR deletion path (`teardown` API). List gaps; draft missing pages in `app/(legal)/` if absent.

### F. Deliverables
1. `docs/audits/full-audit-<date>.md` — findings table: ✅/⚠️/❌ per item, with file/line references.
2. `docs/SUBSYSTEMS.md` — index mapping the 9 SaaS subsystems (Product, Infra, Acquisition, Sales, Onboarding, Retention, Monetization, Finance, Legal) → code paths → owning metric → where that metric is visible today. One table, keep it under 60 lines.
3. Fix in this session only: broken tests, lint, missing env validation, missing legal pages. Anything larger → list as TODO with effort estimate.

Do not push to `main` without showing me the diff summary first.
