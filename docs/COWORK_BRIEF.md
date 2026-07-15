# ResumeAI — Full Project Brief (for Claude Cowork)

A complete, self-contained map of the project: what it is, where everything lives,
how it runs, how to operate it, its current state, and the honest constraints.
Read this first, then drill into the linked docs.

---

## 1. What this is

**ResumeAI** — a live SaaS that generates role-tailored resumes and **auto-applies**
to jobs on the user's behalf, then captures recruiter replies in one inbox.
Positioning ("honest moat"): applies **only where the candidate is genuinely
eligible**, tailors per role, and **verifies each application actually submitted**
(anti-spam / anti-LazyApply). See `docs/strategy/PITCH_MOAT.md`.

- **Live site:** https://resumeai-bot.ru
- **Owner / dogfood candidate:** Maxim (Sydney, AU) — account `max737books@gmail.com`.

## 2. Where everything lives (repos & machines)

| Thing | Location |
|---|---|
| **Active product repo** | GitHub `maksimabramov105-dotcom/Micro-SaaS-Starter-Kit` (public) → local `~/code/Micro-SaaS-Starter-Kit` |
| Archived legacy bot | GitHub `maksimabramov105-dotcom/resume-ai` (public, **archived** — the old Telegram bot) |
| Retired local clone | `~/resume-ai-bot` — legacy, **do not push** (remote archived/404) |
| **Production VPS** | `root@178.105.185.214`, app dir `/opt/resumeai` |
| Container registry | GHCR `ghcr.io/maksimabramov105-dotcom/resumeai-{web,worker,notifier}` |
| Persistent memory (Claude) | `~/.claude/projects/-Users-maksimabramov-resume-ai-bot/memory/` — richest log is `project_autoapply_test_max737.md` |

## 3. Architecture (3 services + infra)

Single Hetzner VPS, Docker Compose (`/opt/resumeai/docker-compose.yml`):

| Container | Tech | Role |
|---|---|---|
| `resumeai-web` | **Next.js 16** App Router (Node standalone) | UI, API routes, cron endpoints, Prisma. Internal port **3000** (NOT host-published; behind Caddy) |
| `resumeai-worker` | **Python FastAPI + Playwright** | Scraping + the actual browser auto-apply. Port 8000 |
| `resumeai-notifier` | Python | Redis pub/sub → Telegram notifications |
| `resumeai-db` | **Postgres** (Prisma schema, 30 models) | All data |
| `resumeai-redis` | Redis | Distributed locks, rate-limits, pub/sub |
| `resumeai-caddy` | Caddy | TLS reverse proxy (80/443), www→non-www 301 |
| `uptime-kuma` | — | Uptime monitoring (port 3001) |

**Repo layout (`~/code/Micro-SaaS-Starter-Kit`):**
- `app/` — Next pages + `app/api/**` route handlers (auth, stripe, cron, inbox, campaigns, resumes…)
- `lib/` — web business logic (`eligibility.ts`, `quota.ts`, `funnel.ts`, `auth.ts`, `stripe.ts`, `subscription.ts`, `inbox/`, `pmf/`, `flags.ts`, `scheduling.ts`…)
- `prisma/schema.prisma` — DB models
- `worker/worker/` — Python worker:
  - `routes/jobs.py` — worker HTTP endpoints (`/jobs/scrape/{board}`, `/jobs/score`, `/jobs/autoapply/careerops`, `/jobs/cover-letter`, `/jobs/autoapply/prepare`, `/jobs/resume-pdf`…)
  - `autoapply/careerops.py` — **the apply engine** (per-ATS handlers + fill/submit helpers)
  - `autoapply/eligibility.py`, `autoapply/common.py`, `autoapply/linkedin.py`
  - `ai/` — `jobfit.py` (fit scoring), `cover_letter.py`, `tailor.py`, `resume.py`, `keywords.py`, `critique.py`
  - `scrapers/` — one module per source (see §5)
- `notifier/` — Python notifier service (`main.py` = Redis pub/sub loop)
- `components/`, `public/`, `extension/` (Chrome extension), `e2e/`, `__tests__/`
- `docs/` — architecture, strategy, runbooks, audits, marketing (see §9)

## 4. The auto-apply pipeline (the core loop)

**Entry:** `app/api/cron/run-campaigns/route.ts` (fires every 30 min via GitHub Actions).
Flow per active campaign:
1. **Scrape** jobs (worker `/jobs/scrape/{board}` → `worker/scrapers/*`). Greenhouse is pre-scraped once/run into a cache; other sources per-keyword.
2. **Score** fit (worker `/jobs/score` → `ai/jobfit.py`) — gated by `jobfit_min_score` flag (threshold 45).
3. **Eligibility filter** (`lib/eligibility.ts`): work-auth/region knockouts (`remote_region`, `work_auth`) + seniority distance (`seniority_mismatch`, via `targeting_v2` flag).
4. **Generate a tailored cover letter** (worker `/jobs/cover-letter`) — added this session; every apply gets one.
5. **Apply** (worker `/jobs/autoapply/careerops` → `careerops.py`): detect ATS from URL → run the matching handler → fill form → `_verify_submitted` (conservative; no phantom successes).
6. **Record** `JobApplication` (status SUBMITTED / FAILED / QUEUED) + funnel telemetry.

**Apply engine `careerops.py`** — handlers: `apply_greenhouse`, `apply_lever`, `apply_ashby`,
`apply_workable_view`, `apply_smartrecruiters`, `apply_jobvite`, `apply_generic_form`.
Shared helpers: `_fill`, `_fill_phone`, `_fill_location_autocomplete`, `_fill_lever_location`,
`_candidate_city`, `_fill_unanswered_required` (heuristic→LLM→fallback), `_collect_unanswered_required`,
`_check_required_boxes`, `_upload_resume`, `_bounded_click`, `_verify_submitted`.

## 5. Job sources (what's fillable vs not)

**Fillable direct-ATS (apply works):** `greenhouse.py`, `lever.py`, `ashby.py`, `recruitee.py`,
`personio.py` — curated `_COMPANIES` lists (~150 companies; see the files).
**Aggregator boards (DISCOVERY ONLY — hide the real apply URL, proven dead ends):**
`remoteok.py`, `wwr.py`, `himalayas.py`, `arbeitnow.py`, `themuse.py`, `adzuna.py`.
**Workable** (`workable.py` + `apply_workable_view`): global search = ~24k jobs; scraper works,
form now fills, **but submit is opaquely blocked → `source_workable` flag DISABLED** (code dormant).

## 6. Feature flags (DB table `FeatureFlag`)

`source_lever/ashby/himalayas/wwr/recruitee/personio/remoteok = ON`; **`source_workable = OFF`**.
`jobfit_min_score` = ON, `rolloutPct`=45 (doubles as the fit threshold). `targeting_v2` = ON, 100.
Toggle: `docker exec resumeai-db psql -U resumeai -d resumeai -c "UPDATE \"FeatureFlag\" SET enabled=... WHERE key='...'"`.

## 7. Deploy & ops

- **Deploy = push to `main`** → GitHub Actions `.github/workflows/deploy.yml` builds GHCR images
  (web+worker+notifier) → SSH-deploys + rolls containers (~6–8 min).
- Merge a PR: `gh pr merge <N> --squash --admin`.
- **Crons** are GitHub Actions scheduled workflows POSTing to `/api/cron/*` with `CRON_SECRET`:
  `run-campaigns.yml` (`*/30`), `digest.yml` (hourly), `follow-up.yml` (9am). GitHub delays these
  (effective ~90 min for run-campaigns).
- **CI gates:** build+lint, e2e-journey, CodeQL, "No Cyrillic in source", seo_health (title ≤65 / desc ≤160).
- **DB access:** `ssh root@178.105.185.214 'docker exec resumeai-db psql -U resumeai -d resumeai -c "..."'`
- **Trigger a run manually** (web:3000 is internal, no curl/node in web container):
  `docker exec -e CS="$(docker exec resumeai-web printenv CRON_SECRET)" resumeai-worker python -c "import os,httpx; print(httpx.post('http://resumeai-web:3000/api/cron/run-campaigns', headers={'Authorization':f'Bearer {os.environ[\"CS\"]}'}, timeout=25).text)"`
- **Secrets** in `/opt/resumeai/.env`: OPENAI_API_KEY, STRIPE_*, GOOGLE/GITHUB OAuth, NEXTAUTH_SECRET,
  CRON_SECRET, WORKER_SECRET, RESEND_API_KEY, TELEGRAM_BOT_TOKEN, DATABASE_URL.
- **GOTCHA — git push:** `git push origin` may fail auth mid-session. Use
  `git push "https://x-access-token:$(gh auth token)@github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit.git" <branch>:<branch>`. `gh pr` (API) works fine.
- **Prod scripts:** web image is Next standalone (no `scripts/`/`tsx`); run one-offs against prod via
  psql or `docker exec` python in the worker.

## 8. Current state (2026-07-14)

- **Dogfood account max737** (userId `cmpffnodl0000of0fo3a00uhn`), 3 active campaigns:
  Customer Support (kw `support`), AI Automation (kw `python`), Customer Success (kw `customer success`).
  `authorizedCountries` = Australia, New Zealand, **United States** (US unblocked as remote contractor,
  `needsVisaSponsorship=false`). Two resumes: **Technical Support Engineer** + **AI Automation Specialist**,
  both carrying `Portfolio: resumeai-bot.ru | GitHub: github.com/maksimabramov105-dotcom`.
- **Metrics:** 72 SUBMITTED · 161 FAILED · 7 REJECTED all-time; inbox 293 automated acks + 10 rejections
  + **0 interviews**. Stripe MRR $0 (pre-launch; all users are test/dogfood).
- **Reply/PMF dashboards:** `/admin/pmf` (admin-gated), `/proof`. `scripts/funnel_report.ts`.

## 9. Key docs to read next

- `docs/ARCHITECTURE.md`, `docs/SUBSYSTEMS.md`, `docs/PROJECT_MAP_RU.md`, `docs/HANDOFF.md`, `docs/SCALING.md`
- Strategy: `docs/strategy/PITCH_MOAT.md`, `FIT_TARGETING.md` (targeting principle),
  `WORKABLE_APPLY_SCOPING.md`, `STRATEGIC_ANALYSIS.md`, `SAAS_GAP_ANALYSIS_2026-06.md`
- Runbooks: `docs/runbooks/deploy.md`, `docs/runbooks/uptime-and-cloudflare.md`
- Marketing: `docs/marketing/` (launch playbooks, SEO, ~79-page programmatic SEO bundle is live)
- Claude memory: `~/.claude/projects/-Users-maksimabramov-resume-ai-bot/memory/project_autoapply_test_max737.md`
  (the most detailed running log of every fix + finding).

## 10. Honest constraints (proven — don't re-chase)

1. **Aggregator boards hide the apply URL** (RemoteOK/WWR/Himalayas/Arbeitnow) — even headless can't
   extract it. Discovery signals only, never apply targets.
2. **Workable apply not automatable:** form fills, but submit is opaquely blocked (no validation error,
   no captcha, form just doesn't complete). Disabled. Re-verify before re-enabling.
3. **Volume for one narrow profile is finite → comes in BUMPS, not sustained 30/day.** Each supply
   addition (companies / US-unblock) gives a burst, then dedup-exhausts. No continuous auto-submittable
   source exists.
4. **Interviews (0) are a conversion problem, not a delivery one.** Applications reach humans
   (Intercom/Gusto reviewed + rejected). The gating factor is candidate competitiveness — no LinkedIn,
   freelance-only history. The strongest remaining lever (a real LinkedIn / stronger profile) is the
   user's to provide; code can't manufacture it.

## 11. Levers that DO work (for future sessions)

- **Add more verified fillable companies** to `greenhouse/lever/ashby` `_COMPANIES` (verify each token
  returns jobs first). Gives a fresh burst.
- **Broaden eligibility** per campaign (`authorizedCountries`) — US unblock was the biggest single lever.
- **Improve conversion** via the candidate profile (out of code scope) + per-job resume tailoring
  (worker `autoapply/prepare` exists but isn't wired into the careerops apply path — a real TODO).
- **Fix-brak work** (this session): bounded submit clicks, Lever required-field fill, radio-question
  detection — all shipped; failure rate is now near-zero on Greenhouse.
