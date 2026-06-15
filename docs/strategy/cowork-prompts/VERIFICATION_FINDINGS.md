# Verification findings — docs checked against live code (2026-06-04)

I re-read the **real** `Micro-SaaS-Starter-Kit` repo and corrected the prompt pack. This is the audit trail: what I originally assumed (from the HANDOFF doc) → what the code actually shows → the correction.

## What's already built — do NOT rebuild

| Thing my first draft said to "add" | Reality in the repo |
|---|---|
| Add lifecycle status to applications | `ApplicationStatus` enum (`QUEUED/SUBMITTED/FAILED/INTERVIEW/REJECTED/OFFER/WITHDRAWN`) + `ApplicationEvent` model already exist (`prisma/schema.prisma:435,572`). |
| Add reply-capture pipeline + verify it | **Already built and verified working** — Resend inbound + Svix signature (`lib/inbox/inbound-utils.ts`), `app/api/inbox/inbound/route.ts`, classifier `lib/inbox/classify.ts`. `docs/REPLIES_SETUP.md` documents an end-to-end live test that passed on 2026-05-30. |
| Add knockout / work-auth question handling | **Already exists** in `worker/worker/autoapply/careerops.py` (`_answer_screening`, `_verify_submitted`, LLM fallback). The problem is its **hardcoded answers**, not its absence. |
| Cap Playwright concurrency / add OOM guard | **Already done** — `run-campaigns` runs campaigns sequentially, "peak browser concurrency is always 1", `MAX_APPLIES_PER_CAMPAIGN=8`, `RUN_BUDGET_MS=600_000`, background `after()`. |
| Add error tracking | **Sentry already wired** (`sentry.client/edge/server.config.ts`). |
| Add feature flags + A/B testing | **Already exist** — `FeatureFlag`, `Experiment`, `ExperimentAssignment` models + `lib/flags.ts` (`isResumeQualityV2`). |
| Add a job-source enum/registry | `JobSource` enum exists (`LINKEDIN, CAREEROPS, ADZUNA, ARBEITNOW, REMOTEOK, THEMUSE, MANUAL`). Needs **new values** for the added remote/ATS sources (Himalayas, Recruitee, Personio, WWR), not a new system. |
| Build / revive the Chrome extension | **Already built** — `extension/` manifest v3 "ResumeAI Autofill", content scripts for Greenhouse/Lever/Workable/SmartRecruiters/Jobvite/Ashby, wired to `app/api/extension/*`. |
| Build a free resume-teardown lead magnet | **Already exists** — `app/free-resume-teardown/page.tsx` + `Lead` model. |
| Add refund/guarantee | Refund **route exists** (`app/api/billing/refund`). The "guarantee" is marketing copy, not code. |
| Add referral program | **Already exists** — `Referral` model (double-sided $20), `app/r/[code]`, `app/dashboard/referrals`. |

## What's genuinely missing (the real backlog)

1. **Eligibility is hardcoded & dishonest.** `careerops.py:284-285,383-384,769` always answers *"authorized to work in the US; does NOT require visa sponsorship"* — regardless of the job's country or the candidate's real status. For a CIS candidate applying to US/EU roles this produces "submitted-then-ghosted." **This is the #1 fix.**
2. **No per-user eligibility profile** (countries authorized, needs sponsorship, relocation, remote-only). `AutoApplyCampaign` has keywords/locations/experience but nothing about work authorization.
3. **No job-fit scoring / eligibility pre-filter.** Per-application AI *tailoring* exists (`tailoredResume`, `tailoringTokensUsed`), but there is **no matching/scoring** — only a passing mention in `app/privacy/page.tsx`. The system applies regardless of fit.
4. **Narrow eligible sourcing.** Heavy on US on-site ATS; missing remote/international-friendly boards (RemoteOK/Himalayas/WeWorkRemotely) + EU SMB ATS (Recruitee/Personio) where this candidate is actually eligible and reply rates are higher. (HH.ru/SuperJob are *not* viable — they denied API access; scraping = ban risk.)
5. **Throughput ceiling, not OOM.** Concurrency=1 + 600 s budget every 2 h, and a Greenhouse apply takes 60–100 s (incl. emailed security-code). That's ~5–6 applies per single-campaign run — fine for 2 users, **cannot serve 100 active campaigns**. The scale risk is starvation, not memory.
6. **Thin remote/eligibility positioning + landing proof.** The product doesn't yet say "we only apply where you're eligible, remote-first" — the one thing that separates it from US-centric incumbents. (Payments stay Stripe-only — no local rails needed.)
7. **Two blind spots already noted in-repo:** LinkedIn replies are "LinkedIn inbox only — not email-trackable", and Telegram notifications are dropped because no users have linked Telegram (onboarding gap).

## Net assessment of the original pack

Direction was right (silence = targeting/eligibility/market-fit, *not* "too few platforms"). But it told you to build several things that already exist, mis-stated "Greenhouse only" (it's LinkedIn + CareerOps across 6 ATS + 5 scraper sources), and missed the repo's own documented finding plus the hardcoded-work-auth root cause. The corrected `00`–`03` reflect the live code.
