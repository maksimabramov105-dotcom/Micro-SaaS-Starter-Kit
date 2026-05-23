# Prompt 09 — Port features from `resume-ai` into `Micro-SaaS-Starter-Kit`

> **Paste into Claude Code at the root of `Micro-SaaS-Starter-Kit`. This prompt assumes Path B has been chosen: MSSK is canonical, `resume-ai` is being phased out. Major refactor + multi-PR migration. Behind feature flags throughout.**
>
> ⚠️ **READ FIRST:**
> - `docs/strategy/MERGE_AND_DIRECTION_DECISION.md` — the full context for why this migration exists
> - `docs/strategy/STRATEGIC_ANALYSIS.md` — feature decisions and roadmap
> - `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` — drift corrections for prompts 02-08

## Why
You have valuable feature work sitting in the **legacy `resume-ai` repo on branch `claude/wonderful-carson-cc1225`** (21 commits, +25,989 LOC) that needs to land in **MSSK** so the modern stack matches feature parity with the old one. After this, the legacy repo is archived and all future work happens here.

## Pre-flight (do BEFORE writing any code)

1. Add `resume-ai` as a read-only remote so you can reference its files:
   ```bash
   git remote add legacy https://github.com/maksimabramov105-dotcom/resume-ai.git
   git fetch legacy claude/wonderful-carson-cc1225:legacy/wonderful-carson
   git fetch legacy audit/rebuild-plan:legacy/audit-plan
   git fetch legacy extract/clean-python-worker:legacy/clean-python-worker
   ```
   You will reference these branches with `git show legacy/wonderful-carson:<path>` — you will NOT merge them into MSSK directly (different architectures).

2. Read the audit report:
   ```bash
   git show legacy/audit-plan:_rebuild-plan/AUDIT_REPORT.md | less
   ```
   It classifies every legacy file as KEEP / EXTRACT / KILL / INVESTIGATE. Honor that classification — anything KILL stays dead.

3. List wonderful-carson's commits to understand the scope:
   ```bash
   git log --oneline main..legacy/wonderful-carson
   ```
   Expect 21 commits labeled P02 through P13 + fixes.

## What to port (in dependency order)

### Already in MSSK — no work needed
- P02: international-only worker (English scrapers in `worker/worker/scrapers/`)
- P09: drop CryptoBot/VK/RU payments (MSSK never had them)
- P11: per-job resume tailoring (`worker/worker/ai/tailor.py`)
- P08 partial: reply inbox infra (`InboxMessage` Prisma model, `lib/inbox/`)
- P10 partial: daily digest (`lib/notifications/daily-digest.tsx`)

### To port — high priority (revenue-relevant)

#### Port 1 — Portfolio system (P05 from `legacy/wonderful-carson`)
Each user gets a public portfolio page at `resumeai-bot.ru/p/{username}` showing their resume, links, and uploaded assets. Strong conversion + viral asset.

- Read: `git show legacy/wonderful-carson:scripts/migrations/2026_05_add_portfolios.sql` and `2026_05_add_user_links.sql` for schema shape
- Prisma additions: `Portfolio { id, userId, slug, title, summary, isPublic, theme, viewCount, createdAt, updatedAt }`, `UserLink { id, userId, label, url, sortOrder, isPublic }`, `PortfolioAsset { id, portfolioId, kind, url, caption, sortOrder }`
- New routes: `GET /p/[slug]` (public), `app/dashboard/portfolio/page.tsx` (manage), `app/api/portfolio/route.ts` (CRUD), `app/api/portfolio/[id]/links/route.ts`
- SEO: `metadata` export on the public page with OG image generated server-side
- Feature flag: `portfolio_v1`
- Tests: portfolio CRUD, public page renders correctly when `isPublic=true`, returns 404 when private

#### Port 2 — Voice-AI resume builder (P06 from `legacy/wonderful-carson`)
User records voice answers to a 5-question prompt, Whisper transcribes, GPT-4o-mini turns it into a resume draft.

- Reference: `git show legacy/wonderful-carson:bot/handlers/resume.py` for the question flow and prompt structure
- Web flow: `app/dashboard/resumes/new/voice/page.tsx` — record button per question, MediaRecorder API to MP3/webm, POST to worker
- Worker route: `POST /resumes/voice` — accepts audio file, calls OpenAI Whisper, returns transcript
- Then run the existing tailored-resume generator (after Prompt 02 ships V2 prompts)
- Feature flag: `voice_resume_v1`
- 30-second timeout per recording, 5-question max
- Tests: mock Whisper, verify pipeline produces structured resume JSON

#### Port 3 — Career-ops sidecar quality engine (P10 from `legacy/wonderful-carson`)
The "career-ops" sidecar is what made wonderful-carson "close the gap vs Sonara." It's an external ATS-quality + resume-feedback engine. Reference: `git show legacy/wonderful-carson:vendor/career-ops` for what was vendored.

- Decision needed: is career-ops a separate FOSS project or a custom build? Check `vendor/career-ops` and its license. If custom and you own it, copy into `worker/worker/quality/`. If FOSS, vendor it as a git submodule in MSSK.
- Wire into the tailor flow as a post-generation pass — similar role to the "critique pass" in Prompt 02. May overlap or replace.
- Feature flag: `career_ops_v1`
- Tests: deterministic input → expected quality score

#### Port 4 — Testimonials + onboarding + demo (P11 from `legacy/wonderful-carson`)
- Reference: `git show legacy/wonderful-carson:autoapply/testimonials.py` and the `autoapply/static/app.html` testimonials section
- Add `Testimonial { id, userId, content, rating, approved, displayName, role, createdAt }` to schema
- Public testimonials grid on `/` landing
- Admin moderation UI at `/admin/testimonials`
- Onboarding wizard for new signups: 4 steps (welcome → upload/create resume → set job preferences → install Chrome extension)
- Demo: embedded YouTube video on landing (per `legacy/wonderful-carson` commit `945f390`)
- Feature flag: `testimonials_v1`, `onboarding_v1`

### To port — medium priority

#### Port 5 — Applications hub with 3 statuses + wide filter (P07 from `legacy/wonderful-carson`)
- Reference: `git show legacy/wonderful-carson:autoapply/autoapply_main.py` (the `/api/applications` route handler) and `autoapply/static/app.html` (the UI)
- MSSK already has `JobApplication` model — extend to include `status: 'submitted' | 'viewed' | 'rejected' | 'interview' | 'offer'`
- Build dashboard page `app/dashboard/applications/page.tsx` with filter dropdowns (date range, status, source, company)
- Feature flag: `applications_hub_v1`

#### Port 6 — Telegram↔web unified identity / SSO (P04 from `legacy/wonderful-carson`)
- Single account: a user can log in via web OR connect a Telegram account; both surfaces share the same user record
- MSSK already has `TelegramChat` model — extend the bot side to allow `/start <connect_token>` linking
- Bot side: build/refresh the aiogram bot under `bot/` (new top-level service in `docker-compose.yml`)
- Decision needed: do you want a Telegram bot in MSSK at all, or is the Chrome extension + web enough? Telegram was a primary surface in resume-ai but may be redundant given the extension. **Recommend skipping** unless you have evidence Telegram drives signups.

### To DROP — explicitly do NOT port (per audit report KILL list)
- `generate_seo_pages.py` (Russian SEO templates)
- `marketing_cron.py` (VK/Telegram channel scheduling)
- `seo/submit_directories.py` (RU directory submissions)
- `submit_sitemaps.py` (already in Next.js sitemap.xml)
- `submit_to_directories.py`
- Streamlit dashboard (`dashboard.py`)
- CryptoBot integration
- Yandex Metrika / VK OAuth
- All hh.ru / SuperJob code (already dead per WORKTREE_AUDIT_AND_CORRECTIONS.md fix 3)

## Implementation pattern (per port)

1. Create branch `migrate/<port-name>` (e.g. `migrate/portfolio-system`)
2. Read the legacy reference files via `git show legacy/wonderful-carson:<path>` — DO NOT copy code blindly, RE-IMPLEMENT in MSSK's idioms (TypeScript/Prisma/Next.js, not Python/SQLite/Jinja)
3. Add Prisma migration if schema changes
4. Add web routes, worker routes, UI as needed
5. Wire feature flag (use the system from Prompt 08 once it's live; until then, env var)
6. Tests required: ≥ 1 unit test per new endpoint, ≥ 1 e2e test for any new user flow
7. PR → CI → deploy → **VPS health check (see footer)**
8. Smoke test in prod with flag ON for your account, OFF for everyone else
9. Gradual rollout via Prompt 08 flags: 10% → 50% → 100% over 7 days
10. Update `docs/ARCHITECTURE.md` with the new subsystem

## Acceptance gate — Don't move to next Port until current Port has:
- Prod deploy verified via VPS health check footer
- Feature flag works both ways
- At least one real user (you) has used the feature end-to-end
- No new Sentry errors above baseline for 48 hours

## Branch hygiene on `resume-ai` (do AFTER all ports complete)

Once all priority ports are in MSSK and verified in prod for 14 days:

```bash
# In a clone of resume-ai:
# Archive dead branches
for b in claude/laughing-shirley-40d1cd copilot/research-overall-architecture worktree-agent-ad90a1fa3400c9688; do
  git branch -m "$b" "archive/$b"
  git push origin :"$b" "archive/$b"
done

# Merge useful branches to main, then archive
git checkout main
git merge --no-ff audit/rebuild-plan -m "docs: merge legacy audit report"
git push origin main
git push origin :audit/rebuild-plan

# Wonderful-carson's work has been ported to MSSK — archive the source
git branch -m claude/wonderful-carson-cc1225 archive/claude/wonderful-carson-cc1225
git push origin :claude/wonderful-carson-cc1225 archive/claude/wonderful-carson-cc1225

# Extract/clean-python-worker — if abandoned (Path B chosen), archive
git branch -m extract/clean-python-worker archive/extract/clean-python-worker
git push origin :extract/clean-python-worker archive/extract/clean-python-worker
```

Then add `MIGRATION_NOTICE.md` to the root of `resume-ai`:

```markdown
# This repo is archived

All active development has moved to:
**https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit**

The features previously developed here (per-job tailoring, daily matches,
portfolio system, voice AI resume builder, career-ops integration,
applications hub, reply inbox) have been ported to the new repo.

This repo is preserved as a reference snapshot. No new features will be merged.
The live VPS at resumeai-bot.ru is served from the new repo.

Branches starting with `archive/` are preserved for historical reference.
```

Commit, push, then **disable GitHub Actions on this repo** (Settings → Actions → Disable).

## VPS deploy verification (REQUIRED, hard-fail)

At the end of EVERY port PR, before declaring the prompt step complete, you MUST run this verification block. If ANY check fails, the step is not done.

```bash
# 1. Confirm you are on the right repo
git remote -v | grep -q "Micro-SaaS-Starter-Kit" || { echo "FATAL: wrong repo"; exit 1; }

# 2. Confirm main is at the same SHA as the deployed VPS
LOCAL_SHA=$(git rev-parse origin/main)
VPS_SHA=$(ssh root@resumeai-bot.ru "cd /opt/resumeai && git rev-parse HEAD")
[ "$LOCAL_SHA" = "$VPS_SHA" ] || { echo "FATAL: VPS drifted from main"; exit 1; }

# 3. Confirm all containers are up
ssh root@resumeai-bot.ru "cd /opt/resumeai && docker compose ps --status running | wc -l" \
  | awk '$1 < 6 { print "FATAL: container down"; exit 1 }'

# 4. Smoke-test the public site
curl -sf -o /dev/null -w "%{http_code}\n" https://resumeai-bot.ru/ | grep -q 200 \
  || { echo "FATAL: landing page not 200"; exit 1; }

# 5. Smoke-test the API
curl -sf -o /dev/null -w "%{http_code}\n" https://resumeai-bot.ru/api/health \
  | grep -q 200 || { echo "FATAL: API not healthy"; exit 1; }

# 6. Confirm the feature flag for the new port is observable (queryable)
ssh root@resumeai-bot.ru "cd /opt/resumeai && docker compose exec -T web npx prisma db execute --stdin <<< 'SELECT key, enabled FROM \"FeatureFlag\" WHERE key = '\''<your-flag-key>'\'';'"

echo "VPS verification: PASS"
```

**The PR description must include the full output of this block.** If you cannot SSH to the VPS, the deploy is not done and the prompt is NOT complete — stop and ask for credentials or pipeline help.

## Rules
- All ports go through feature flags. Default OFF. Enabled per-user (you first) before any rollout.
- Never `git merge` from `legacy/*` into MSSK branches. Re-implement, don't copy.
- Every PR is small (one port per PR).
- Cyrillic content from legacy never enters MSSK. If you see Russian text in a reference file, ignore it — MSSK is English-only.
- DB migrations are additive only during ports. Schema deletions happen in a separate cleanup PR after the port is stable.
- Update `docs/ARCHITECTURE.md` with each port.

## Definition of done (whole prompt)
- All 4 high-priority ports (1–4) live in prod, flag-gated, verified
- Medium-priority ports (5–6) decided: ported or explicitly skipped with reasoning in `docs/ARCHITECTURE.md`
- Branch hygiene on `resume-ai` done: dead branches archived, useful branches merged-and-archived, `MIGRATION_NOTICE.md` added, Actions disabled
- VPS health check passes after every port
- `docs/strategy/STRATEGIC_ANALYSIS.md` updated: append "Migration from resume-ai complete" section
- All work on `main` of MSSK. No orphan work-in-progress branches.
