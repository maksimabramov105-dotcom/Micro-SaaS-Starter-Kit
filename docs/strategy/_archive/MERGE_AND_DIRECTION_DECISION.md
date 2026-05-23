# Merge & direction decision — what I found in `resume-ai`

**Date:** 2026-05-23 (second pass)
**Trigger:** Worktrees pushed to `resume-ai` remote (NOT `Micro-SaaS-Starter-Kit`)
**Critical finding:** You have **two separate repos** for the same product, with active work scattered across both. Before I can safely rewrite prompts, you have to pick one.

---

## 1. The two repos

| | `resume-ai` | `Micro-SaaS-Starter-Kit` (MSSK) |
|---|---|---|
| URL | github.com/maksimabramov105-dotcom/resume-ai | github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit |
| Architecture | Python monolith — aiogram bot + FastAPI + SQLite + Streamlit + static Next.js 14 landing | Modern stack — Next.js 16 (App Router) + Python FastAPI worker + Python notifier + Postgres + Prisma + Redis + Caddy |
| Top-level | Python files everywhere (`run.py`, `dashboard.py`, `analytics_tracker.py`, etc.) | TypeScript app + nested worker/notifier services |
| DB | Two SQLite files (`bot.db`, `autoapply.db`), WAL mode | PostgreSQL via Prisma |
| Containers | One (`app` on :8000) | Six (postgres, redis, web, worker, notifier, caddy) |
| README claims live at | resumeai-bot.ru, VPS path `/opt/resumeaibot` | resumeai-bot.ru, VPS path `/opt/resumeai` |
| Active worktrees | **Yes — claude/laughing-shirley, claude/wonderful-carson, worktree-agent, audit/rebuild-plan, extract/clean-python-worker** | None pushed |
| Cyrillic content | 163 files contain Russian (legacy Russian-market codebase) | None |
| My 8 prompts target | NO | **Yes — all prompts written against this stack** |

**Both repos claim to deploy to the same VPS at slightly different paths.** Without SSH access I cannot tell you which is actually running. But the evidence strongly suggests `resume-ai` is live (Claude Code is actively working there, the audit was done against it, the worktrees were pushed there).

---

## 2. All branches on `resume-ai` right now

| Branch | Status | What it has | Recommendation |
|--------|--------|-------------|----------------|
| `main` | HEAD `34b032e` — base of truth | Latest stable | Keep |
| `claude/laughing-shirley-40d1cd` | **Same SHA as main — empty** | Nothing unique | Delete |
| `copilot/research-overall-architecture` | **Same SHA as main — empty** | Nothing unique | Delete |
| `claude/wonderful-carson-cc1225` | **21 commits ahead** — 190 files, +25,989 / −5,229 | The big one. P02 through P13 work: remove HH.ru/SuperJob/VK/CryptoBot, English-default, per-job resume tailoring, career-ops sidecar, voice-AI resume builder (Whisper + GPT-4o-mini), portfolio system, applications hub, reply inbox, daily personalized job-match digest, templates/demo/testimonials/referral/onboarding, launch readiness 2026-05 sign-off | **Merge to main ASAP** |
| `audit/rebuild-plan` | 1 commit ahead | `_rebuild-plan/AUDIT_REPORT.md` — 30+ commit history audit, classifies every legacy file as KEEP/EXTRACT/KILL/INVESTIGATE | Merge to main (docs) |
| `extract/clean-python-worker` | 2 commits ahead | Extracts a clean English-only FastAPI worker from the legacy codebase | Likely the seed of a rebuild — keep, but decide whether to continue |
| `worktree-agent-ad90a1fa3400c9688` | **5 commits — BEHIND main** | Old bug fixes (hh.ru OAuth, FSM state, language router) — already superseded by main | Delete (work superseded) |

---

## 3. What `claude/wonderful-carson` actually delivers (21 commits)

This branch is huge and is your real asset. From oldest to newest:

```
0c2a7e8 [BLOCK-3] P02: remove HH.ru/SuperJob, international-only worker
39f0215 [BLOCK-1] P03: English-default landing, GA4+PostHog consent, drop Yandex/VK/RU
45ba35d [BLOCK-2,4,6] P04: unified telegram↔autoapply identity (SSO-style)
f794fbb [BLOCK-1,2,6] P05: portfolio system (resume + public page + assets + links)
1cce528 [BLOCK-1,2] P06: voice-AI resume builder (Whisper + GPT-4o-mini)
86e3826 [BLOCK-2,1,6] P07: applications hub with 3 statuses + wide filter
3b9217f [BLOCK-2,5] P08: reply inbox — email threading + recruiter reply detection
5e0b4d5 [BLOCK-2,3,4,6,8] P09: remove CryptoBot + VK OAuth + RU payment methods
6c50035 [BLOCK-4,3] P10: daily personalised job-match digest (closes competitor gap vs Sonara)
d4eb451 [BLOCK-2,3,4] P11: per-job resume tailoring (closes competitor gap vs Sonara/career-ops)
70c1381 [BLOCK-1,2] P12: app.html Russia decoupling — final audit items
8566da5 [BLOCK-4,5] P09: bot English-default, autoapply CTAs English-only
1560ed7 [BLOCK-3] P10: integrate career-ops sidecar as quality engine
b65f800 [BLOCK-1,2,4] P11: templates, demo, testimonials, referral, onboarding, daily matches
e310af4 fix: permanent bot + website repair — sync drift prevention
7403bcd [ALL] P12: post-pivot cleanup + docs sync
945f390 fix: DemoVideo — replace local MP4 with YouTube embed
3dbad80 [QA] P13: launch readiness 2026-05 — sign-off
da1a826 fix: patch npm dependency vulnerabilities (dependabot)
933cf64 fix: health_check dashboard — replace stale Streamlit check with nginx + FastAPI
```

**Crucially:** this work already includes some of what my prompts were proposing — per-job resume tailoring (P11), referral system (P11), templates (P11), daily personalized matches (P10). Some of my prompts may be redundant with what's already done here, **inside the resume-ai repo**.

---

## 4. The three honest paths forward

### Path A — Adopt `resume-ai` as canonical, archive `Micro-SaaS-Starter-Kit`

**What it means:** Treat the Python codebase as the real system. Merge `wonderful-carson` + `audit/rebuild-plan` into main. Delete empty branches. Use `extract/clean-python-worker` as the basis for any modernization. My 8 prompts get **rewritten for Python** — different file paths, different framework idioms (FastAPI not Next.js, Jinja2 not React, SQLite/SQLAlchemy not Prisma).

**Pros:**
- Fastest to revenue. The system is already running.
- Wonderful-carson already did Sonara-competing work (per-job tailoring, daily matches). My prompts simplify to "improve what's there" instead of "build from scratch."
- One repo, one source of truth, no confusion.

**Cons:**
- Legacy Python monolith — harder to scale, harder to onboard contractors.
- 163 files still contain Cyrillic — pivot is partial.
- Streamlit dashboard, two SQLite files, no proper migrations — technical debt.
- The Chrome extension, PDF templates, modern flag system from MSSK are not here.

**Right call if:** You want to ship to $10K MRR fast and treat the rebuild as a Q3/Q4 problem.

### Path B — Complete migration to `Micro-SaaS-Starter-Kit`

**What it means:** MSSK is the canonical repo. Port wonderful-carson's 21 commits of feature work INTO MSSK by re-implementing each in the Next.js/Python-worker stack. Archive `resume-ai`. Run my original 8 prompts (with the corrections from §3 of `WORKTREE_AUDIT_AND_CORRECTIONS.md`).

**Pros:**
- Modern stack. Easier to scale, easier to hire.
- Multi-container architecture, real Postgres, real testing infra.
- My existing prompts apply almost as-written (with the corrections doc).

**Cons:**
- **6–10 weeks of porting work** before any new feature ships. Wonderful-carson alone is 25,989 LOC added.
- During porting, you have two systems to maintain.
- VPS deploys for MSSK aren't proven (you said live, but the worktrees are happening in `resume-ai`).
- You lose the launch-readiness sign-off (P13) that `wonderful-carson` already did.

**Right call if:** You're committed to the modern stack for long-term scale and willing to delay $10K MRR by 1–2 months.

### Path C — Hybrid: keep `resume-ai` live, run MSSK as the "v2" rewrite in parallel

**What it means:** `resume-ai` keeps making money (merge wonderful-carson, ship to existing customers). MSSK is the planned rewrite — slow, careful, no production traffic until ready. Eventually cut over with DNS.

**Pros:**
- Best of both. No interruption to revenue while you build the better system.

**Cons:**
- Two codebases to maintain forever (until cutover).
- Most expensive in time + cognitive load.
- Solo-founder death pattern. Strong tendency for v2 to never ship because v1 keeps demanding fixes.

**Right call if:** You have someone to dedicate full-time to v2. With one founder at $500–2K marketing budget, **I do not recommend this path.**

---

## 5. My honest recommendation

**Path A.** Here's why:

1. The system already exists, it's live, the worktrees prove you're actively working there.
2. Wonderful-carson did the exact international pivot the strategic analysis recommended. Some of my prompts (referral, per-job tailoring, daily matches) are already done in code — they just need merging.
3. You have a $10K-in-30-days goal, not a $10K-in-90-days goal. Path B costs you a month minimum.
4. If you do Path A and hit $10K MRR, you'll have the money and the validation to fund the proper rewrite in Q4. You can hire someone to do it cleanly while you keep shipping.
5. The MSSK repo is not wasted — it's a really good architectural reference for v2.

**The cost of Path A:** I rewrite my 8 prompts for Python/FastAPI/aiogram/SQLite instead of Next.js/Prisma. About 2-3 hours of work, all in the strategic docs. The strategy itself, the competition research, the QA findings, the feature decisions (Teams/2FA/Referral/Flags/Affiliate/A-B) are unchanged — only the file paths and implementation patterns change.

---

## 6. Common to all paths — what I'd do regardless

These are merge/hygiene actions you need either way:

1. **Delete empty branches** (`laughing-shirley`, `copilot/research-overall-architecture`, `worktree-agent-ad90a1fa3400c9688`) — they're zero-value noise and cause Claude Code to waste tokens enumerating them.
2. **Merge `audit/rebuild-plan` into main** — the audit report is a valuable doc artifact.
3. **Decide on `extract/clean-python-worker`** — either continue the extraction work (toward Path B/C) or close it (Path A).
4. **Merge `claude/wonderful-carson-cc1225` into main** — this is your real work, never merge it and you have a single-point-of-failure on one branch.
5. **Verify VPS = main** — whichever repo you pick, deploy main to the VPS and confirm the deployed code matches.
6. **All Claude Code work flows: branch from main → PR to main → CI deploys → verify on VPS.** No local-only commits, ever.

---

## 7. The question I need you to answer

**Which path?**

Pick one. The next response from me writes the rewrites you need to execute it.
