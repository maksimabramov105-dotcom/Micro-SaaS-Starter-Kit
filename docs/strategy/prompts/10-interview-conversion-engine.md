# Prompt 10 — Interview Conversion Engine (THE revenue-critical prompt)

Copy everything below into Claude Code, run from `~/code/Micro-SaaS-Starter-Kit`.

---

Context: we have 300+ verified submitted applications and **zero INTERVIEW_REQUEST** inbox messages. Market benchmark is ~1 interview per 40–50 applications, so the expected value was 6–9. This is structural, not luck. Your job: find and fix the conversion killers, then instrument the funnel so we can prove improvement. Read `docs/PROJECT_MAP_RU.md`, `app/api/cron/run-campaigns/route.ts`, `lib/eligibility.ts`, `worker/worker/autoapply/careerops.py`, `worker/worker/autoapply/eligibility.py` first. Hard constraints: single VPS, honest screening answers (never lie about work authorization), no fake data.

## Phase 1 — Forensics on the 300 applications (read-only, prod DB)
Write `scripts/application_forensics.ts` that reports, for every JobApplication:
1. Submission date vs the date the contact-data bug (phone/intl-tel-input, `resume.input` contacts) was fixed — how many of the 300 went out with broken contact info? Those are dead; exclude them from conversion math.
2. Whether `RESUME_QUALITY_V2` was active at submission time (check flag history / deploy dates) — how many got the generic V1 resume?
3. Job geography: for each application, the job's location/remote status and the hiring-region signals in the posting (e.g. "remote (US)", "must be authorized to work in the US"). Cross-reference with the campaign profile's `authorizedCountries` / `needsVisaSponsorship`. **Count how many applications were screening-knockouts before a human ever saw the resume.**
4. Reply outcomes per application (join InboxMessage). Produce a funnel: submitted → any reply → human reply → interview.
Output `docs/audits/conversion-forensics-<date>.md` with the table and a ranked root-cause list.

## Phase 2 — Fix the targeting (the expected main killer)
1. **Remote ≠ eligible.** In `lib/eligibility.ts`, `eligibilityKnockout` returns null for ANY remote job. Most "remote" roles at US companies hire only in specific countries. Implement hiring-region detection: parse the job description/location for signals like "remote (US)", "US only", "authorized to work in…", "we can hire in: …", timezone constraints, and the ATS screening questions when available. A remote job whose hiring region excludes all of the profile's `authorizedCountries` (and sponsorship is needed) must be knocked out with a new reason `remote_region`. Keep "unknown → don't skip" only when NO region signal exists.
2. **Pre-apply screening simulation.** Before submitting, the worker already answers screening questions honestly. Add a dry-run check: if the honest answers to detected knockout questions (work auth, visa, location) would auto-reject, skip and log reason `screening_knockout` instead of burning the application. Mirror logic between `lib/eligibility.ts` and `worker/worker/autoapply/eligibility.py`.
3. **Seniority match.** AND-keyword title match doesn't control level. Add a cheap seniority extraction (title regex: intern/junior/mid/senior/staff/principal/lead/manager) and skip jobs ≥2 levels away from the profile's level (add `seniorityLevel` to the campaign profile, default inferred from resume).
4. Re-check `jobfit_min_score` (currently 65): compute the fit-score distribution of replied vs ignored applications from Phase 1 and recommend a threshold with data.

## Phase 3 — Maximize per-application quality
1. Verify `RESUME_QUALITY_V2=true` in prod and that tailored resume + cover letter are actually attached per application (sample 5 recent application payloads).
2. Add an application QA gate: before submit, reject the run if tailored resume is missing quantified bullets, the company name in cover letter is wrong, or contact email ≠ the user's inbox address. Log gate failures.
3. Store per-application proof: final answers given to screening questions + a submission confirmation screenshot path. This becomes both debugging data and the user-facing "proof" feature.

## Phase 4 — Instrument the funnel (so we never fly blind again)
1. Application status lifecycle: SUBMITTED → REPLIED → INTERVIEW → REJECTED / SILENT(>21d). Update from inbox classification automatically.
2. Dashboard: per-campaign funnel with these counts + interview rate. Admin view: global rate week-over-week.
3. Telegram notification to the user (and to admin) on every INTERVIEW_REQUEST — this is the product's "aha" moment, celebrate it in the UI as well (dashboard banner).

## Phase 5 — Tests & rollout
- Unit tests for region detection (≥15 cases incl. "Remote — US only", "Remote (EMEA)", "anywhere", hybrid), screening simulation, seniority match.
- Feature-flag the new knockouts (`targeting_v2`) so we can compare conversion before/after.
- Deliverable: `docs/audits/conversion-fix-<date>.md` summarizing what changed and the metric to watch (interview rate per 100 verified submissions).

Honest expectation to encode in product copy and UX: first recruiter replies within days; interviews typically within 2–3 weeks at a 2–5% rate on eligible, tailored applications. Never promise "interview in 2 days" — build toward making replies that fast instead.

Show me the diff summary before pushing to `main`.
