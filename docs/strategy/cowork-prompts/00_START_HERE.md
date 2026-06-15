# ResumeAI — Strategy + Claude Code Prompt Pack (verified against live code)

_Prepared 2026-06-04. Re-checked against the real `Micro-SaaS-Starter-Kit` repo (not just the HANDOFF doc). See `VERIFICATION_FINDINGS.md` for the full claim→reality→correction audit._

---

## The one-paragraph diagnosis (corrected)

You sent 300+ applications and got essentially no human replies. It is **not** "too few platforms" — you already apply via **LinkedIn + CareerOps (Greenhouse, Lever, Workable, SmartRecruiters, Jobvite, Ashby)** and source from Adzuna/RemoteOK/Arbeitnow/TheMuse/Greenhouse. Two things the repo already proves: the **inbound reply pipeline is healthy** (`docs/REPLIES_SETUP.md`, verified live), and the **submit path was hardened** (`careerops.py` `_verify_submitted()` + real PDF upload + Greenhouse security-code handling), so "phantom submitted" is largely fixed. The remaining root cause is **eligibility**: `careerops.py` hardcodes *"authorized to work in the US; does NOT require visa sponsorship"* for every application, regardless of the job's country or the candidate's real status. An internationally-located candidate applying to US/EU on-site roles passes the auto-filter, lands a confirmed application, then gets **silently ghosted** — which is exactly your symptom. The fix: (1) confirm current SUBMITTED rows are real with one live test, (2) replace hardcoded answers with a real per-user **eligibility profile** + a pre-apply **eligibility filter**, and (3) expand to the **Top-10 worldwide platforms the candidate is actually eligible for** — remote-first boards (RemoteOK/Himalayas/WeWorkRemotely) + startup/EU ATS (Ashby/Lever/Workable/Recruitee/Personio) — which reply far more than US-enterprise Greenhouse. (HH.ru/SuperJob are out — they denied API access; scraping isn't worth the ban risk.)

## Priority order

1. **`01` Phase 0** — one live test application. ~1 hour. Confirms whether SUBMITTED rows are genuinely landing now (post-P19) before you build anything.
2. **`01` Phase 1** — eligibility profile + kill the hardcoded work-auth answers + pre-apply eligibility filter. This is the correctness fix for the silence.
3. **`01` Phase 2** — add the Top-10 worldwide sources (remote boards + startup/EU ATS) behind the existing engine. Highest response-rate ROI for an internationally-located candidate.
4. **`02`** — fix the real scale risk (throughput, not OOM) before any marketing push; verify SEO indexability.
5. **`03`** — close the positioning/feature gaps that are actually missing (job-fit matching, remote/eligibility-aware positioning, distribution of the existing extension + teardown).

## What already exists — don't rebuild it

Reply pipeline, screening-question handling, Sentry, feature flags + A/B, referral program, the Chrome extension, the free-resume-teardown lead magnet, refund route, per-application AI tailoring, application status/event models, sequential apply with OOM guard. Full list + file refs in `VERIFICATION_FINDINGS.md`. Every prompt below is scoped to *extend* these, not duplicate them.

## What's actually missing (the backlog the prompts target)

1. Honest, profile-driven eligibility answers (replace hardcoded US/no-sponsorship).
2. Per-user eligibility profile + pre-apply eligibility filter.
3. Job-fit scoring (tailoring exists; matching/scoring does not).
4. Broader *eligible* sourcing — remote boards (RemoteOK/Himalayas/WeWorkRemotely) + EU ATS (Recruitee/Personio). HH/SuperJob dropped (no API access).
5. Throughput for many concurrent users (current design serves ~a couple).
6. Remote/eligibility-aware positioning + landing-page proof. (Payments stay **Stripe-only** — no local/RU rails.)

## How to run a prompt

`cd` into this repo, paste the **CONTEXT** block once, then run one **PHASE/PROMPT** at a time. Each ends with acceptance criteria. Guardrails (branch, no new infra without asking, verify paths, add a test, small diffs, lint+typecheck) are baked in.

## Solo-dev rule

Everything reuses the existing stack: Next.js / FastAPI / Postgres(Prisma) / Redis / Playwright / Docker Compose on one VPS. New job boards = new values on the existing `JobSource` enum + an adapter following the `careerops`/scraper pattern, gated by the existing `FeatureFlag` system. No new datastores, queues, or services without an explicit decision (`02` flags the one place scale may eventually force that choice).
