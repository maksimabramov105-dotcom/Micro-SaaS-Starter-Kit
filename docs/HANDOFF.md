# ResumeAI — Engineering Handoff

Last updated: 2026-05-31. Read this first when continuing work.

## What this product is
ResumeAI (https://resumeai-bot.ru) — a SaaS that generates tailored resumes and
**auto-applies to jobs** on the user's behalf, then captures employer replies in
an in-app inbox. The core value loop is: generate resume → auto-apply to ATS job
postings → receive confirmations/interviews/rejections by email.

## Where the code is (IMPORTANT)
- **Active product repo: `/Users/maksimabramov/code/Micro-SaaS-Starter-Kit`** ← all work happens here (Next.js 16 web app + Python FastAPI worker).
- Ignore `/Users/maksimabramov/resume-ai-bot` — that's a separate, older Python Telegram bot. The shell may open in a worktree under it, but `cd` to the path above.
- GitHub: `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit`, default branch **`main`**.
  (The git remote URL has an embedded PAT — never print/commit it.)

## Architecture
Monorepo, two services deployed together via Docker Compose on a VPS:
- **web** — Next.js 16 (App Router). API routes, dashboard, auth (next-auth: Google/GitHub/email), Prisma. The campaign orchestrator lives here.
- **worker** — Python FastAPI + Playwright. Scrapes jobs and fills/submits ATS forms. `/Users/.../Micro-SaaS-Starter-Kit/worker`.
- **postgres**, **redis**, **caddy** (TLS/reverse proxy), **notifier** (Telegram), plus **uptime-kuma** (monitoring — leave alone).

## VPS
- Host: **`root@72.56.250.53`** (= resumeai-bot.ru). SSH key already configured locally; `ssh root@72.56.250.53` works.
- App dir: **`/opt/resumeai`** (contains docker-compose.yml, Caddyfile, .env, scripts/).
- DB access: `docker compose exec -T postgres psql -U resumeai -d resumeai -c "<SQL>"`
- Secrets live in `/opt/resumeai/.env` (RESEND_API_KEY, OPENAI_API_KEY (OpenRouter, model openai/gpt-4o-mini), CRON_SECRET, WORKER_SECRET, DATABASE_URL, etc.). The worker also gets OPENAI_API_KEY + RESEND_API_KEY.
- DNS is on **Cloudflare** (zone `d8fd258342ce61c91ef732142bb5d53b`, account `64afe494254f3c212406cf45df92a66d`). The site is Cloudflare-proxied → **~100s origin timeout** (relevant to the cron).

## Deploy pipeline
- Push to `main` → GitHub Actions: **CI** (lint+build), **CodeQL**, **Deploy to Production**.
- Deploy = build web/worker/notifier images → push to GHCR → SSH to VPS (`appleboy/ssh-action`, `command_timeout: 30m`) → `docker compose pull` + `up -d` + `prisma migrate deploy` + smoke test.
- **Deploys are slow (~15–18 min)** — the web image pull on the VPS is the bottleneck (slow link, disk ~83% full). This is expected, not a failure.
- Watch a deploy: `gh run list --limit 5`; `gh run view <id> --json status,conclusion`.
- The worker image updates faster; web is the slow one. After deploy, verify with `ssh root@72.56.250.53 'cd /opt/resumeai && docker compose images web worker'` (check TAG == latest commit SHA).

## How auto-apply works (the core)
Orchestrator: **`app/api/cron/run-campaigns/route.ts`** (triggered every 2h by `.github/workflows/run-campaigns.yml`, and manually — see below). For each active CAREEROPS campaign it: pre-scrapes Greenhouse jobs, interleaves by company (round-robin), then for each job calls the worker's `/jobs/autoapply/careerops`, which runs **`worker/worker/autoapply/careerops.py`**.

`careerops.py` `apply_greenhouse()` flow (the part that matters):
1. Fill standard fields (#first_name, #email, #phone) + autocomplete Country/Location.
2. Fill per-job `question_*` inputs by label.
3. `_answer_react_selects()` — heuristic answers for EEO/work-auth/sponsorship (deterministic, compliance-safe: authorized=yes, sponsorship=no, demographics=decline).
4. `_llm_fill_unanswered()` — batches remaining required questions to the LLM (gpt-4o-mini via OpenRouter, reuses `worker.ai.resume._call_openai`) and applies answers.
5. Submit → `_verify_submitted()`. If not confirmed, `_complete_greenhouse_verification()` polls the user's inbox (via Resend inbound API) for the "Security code for your application" email, enters it, resubmits.
6. Returns `status: submitted` **only on real confirmation** — otherwise `error` (honest metrics; no fake successes).

Reply/inbound pipeline (WORKS): Greenhouse/recruiter email → MX (Cloudflare → Resend inbound) → Resend webhook → `app/api/inbox/inbound/route.ts` → `InboxMessage` row, auto-classified (INTERVIEW_REQUEST/REJECTION). Verified live.

## Current status (2026-05-31) — what's DONE
The core **works and is live**. Live batch test: **5/6 real Greenhouse applications confirmed**, and the inbox now holds real "Thank you for applying to Mixpanel" + "Security code…" emails. Everything below is committed to `main` and deployed:
- Honest submission verification across all ATS handlers + LinkedIn (no more fake "submitted").
- Real **PDF** resume upload (was .txt, which ATSes reject).
- Greenhouse email-**code** completion step.
- **LLM filler** for job-specific questions (commit `74deca8`).
- **Backgrounded apply loop** with Next.js `after()` (commits `9c6cc63` + `a1df632`). `run-campaigns/route.ts` POST now authenticates, schedules the work via `after()`, and returns 200 in ~0.17s; the full run (`runCampaigns()`, a module-level fn) executes in the background free of Cloudflare's timeout. Each campaign gets a **fair time slice** (`RUN_BUDGET_MS / campaigns-left-to-run`) so no campaign starves the others.
- **Broadened required-field detection + hardened code step** (commits `3cff7a1` worker + `6c4438f` web). `_collect_unanswered_required()` now tags and catches EVERY still-empty required field (native `<select>`, radio groups, any required text/textarea/date regardless of id, Country/Location autocompletes, ARIA checkbox widgets); a compliance-safe heuristic tier + ONE batched LLM call answer them; `_commit_field()` commits each and re-verifies; `_count_required_empty()` logs coverage before submit. Resume upload now verifies a file actually attached (fixes "Resume/CV is required"). The Greenhouse email-code field is now polled for ~15s (it renders a few seconds after submit) and the code-email poll widened to 8×4s. In-container across ~20 diverse companies: **required-empty fields = 0 on every job**, effective submit rate **~90%** (vs 0/7 before). Budgets resized to measured reality: a full Greenhouse apply ALWAYS needs the code step and takes **~60-100s**, so `PLAYWRIGHT_MAX_TIMEOUT`=100s, `PLAYWRIGHT_MIN_BUDGET`=105s, `RUN_BUDGET_MS`=600s. Dedup now retries FAILED jobs up to `MAX_FAILED_RETRIES=3` (excludes only submitted/in-flight rows).
- Earlier in session: pause-button fix, OAuth copy, CI deploy `command_timeout` 30m.

## The NEXT task (highest priority) — finish closing the residual ~10%
Field detection is **DONE** (0 empty required across ~20 senior/specialized roles). The residual failures are all in the **email-code delivery** path, not field detection:
1. **Flaky security-code email** (e.g. Intercom failed `code_not_received` twice): the Greenhouse "Security code…" email doesn't always reach the Resend inbound mailbox within the poll window. Investigate whether some companies send from a sender/subject that `_poll_greenhouse_code()`'s filter misses (`"greenhouse" in from`, `"security code" in subject`, `company[:6] in subject`), or whether MX/Resend inbound is simply slow for some senders. The bounded retry (3×) is the current safety net.
2. **Throughput tuning**: with ~60-100s/attempt and `RUN_BUDGET_MS=600s`, a 2-campaign run gets ~2-3 completing attempts per campaign. If a Pro (25/day) or Unlimited user isn't hitting their number, raise `RUN_BUDGET_MS` further (memory is fine — one Playwright page at a time) or run the cron more often than every 2h.
3. **More ATS platforms / a real job source** — see Deferred; only Greenhouse is scraped, and the broadened filler is wired only into `apply_greenhouse` (the other handlers are unused in production).

## Deferred (revisit later)
- **LinkedIn Easy Apply**: code path is complete (UI → encrypted creds → `worker/worker/autoapply/linkedin.py`, now with honest verification). Blockers: needs a user's LinkedIn password; **datacenter-IP login likely triggers LinkedIn security checkpoints**; account-ban risk. To validate, get a throwaway LinkedIn account and test login from the VPS IP. May need residential proxies.
- **More ATS platforms**: only Greenhouse is scraped (worker supports Lever/Ashby/Workable but no scraper feeds them; curated company lists rot — even 9/20 Greenhouse companies 404). A durable fix needs a real job source, not hardcoded slugs.
- **Telegram notifications**: all users have empty `telegramUsername` → notifier drops events (onboarding gap, not a bug).

## How to live-test the worker WITHOUT a full deploy (fast iteration)
```bash
# 1. copy your edited file into the running worker container
scp worker/worker/autoapply/careerops.py root@72.56.250.53:/tmp/c.py
ssh root@72.56.250.53 'cd /opt/resumeai && CID=$(docker compose ps -q worker) && docker cp /tmp/c.py $CID:/app/worker/autoapply/careerops.py'
# 2. run a test script in the container (PYTHONPATH=/app is REQUIRED; cwd alone is not enough)
ssh root@72.56.250.53 'cd /opt/resumeai && docker compose exec -T -e PYTHONPATH=/app worker python /tmp/yourtest.py'
# Long runs: launch detached on the VPS (nohup ... > /tmp/x.log 2>&1 &) and poll the log — SSH can drop long foreground commands.
```
A working test harness pattern: import `from worker.scrapers.greenhouse import search` (signature `search(query="", location="", limit=N)`) and `from worker.autoapply.careerops import CareerOpsApplicator`, then `await app.apply(url, user_data)`. Use inbox handle email `maks-5wl6@resumeai-bot.ru` so confirmation/code emails are receivable.

## Manually trigger a live production cron run
```bash
ssh root@72.56.250.53 'cd /opt/resumeai && CS=$(grep "^CRON_SECRET=" .env | cut -d= -f2); curl -s -m 100 -X POST https://resumeai-bot.ru/api/cron/run-campaigns -H "Authorization: Bearer $CS"'
```
Then read results: `docker compose logs worker --since 3m | grep -iE "routing|filled|submitted|unconfirmed"` and check `InboxMessage` / `JobApplication` tables.

## Conventions / gotchas
- CI has a **Cyrillic guard** — keep all source (code/comments) in English.
- CI does NOT run worker pytest (only web lint+build) — test the worker yourself in the container.
- Never hardcode/commit secrets (bot token, API keys, the PAT in the git remote).
- Commit style ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Users/handles in DB: `cmp79dh8a…` = maksimabramov105@gmail.com (handle maks-5wl6, limit 50); `cmpffnodl…` = max737books (handle max737bo-lpmy, limit 3). 2 CAREEROPS campaigns, 0 LinkedIn.
