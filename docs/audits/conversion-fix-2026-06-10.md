# Conversion Fix — targeting_v2 + funnel instrumentation

**Date:** 2026-06-10 · **Prompt 10 Phases 2–5** · follows `conversion-forensics-2026-06-10.md`

## What changed

### Targeting (`lib/eligibility.ts` + `worker/worker/autoapply/eligibility.py`, behind `targeting_v2`)
1. **Remote ≠ eligible → `remote_region` knockout.** New `detectHiringRegion(text)` parses the job's
   location/title/description for the region the company can actually employ in: "Remote (US only)",
   "authorized to work in the US", "Remote — EMEA", "Remote - UK/Canada", US-timezone constraints,
   and "anywhere/worldwide/global". A remote role whose hiring region excludes all of the profile's
   `authorizedCountries` (and the relocate-without-sponsorship escape doesn't apply) is now skipped
   as `remote_region`. **No signal → not skipped** (never skip on uncertainty).
2. **Honest screening simulation.** The gate is the pre-apply mirror of the worker's honest answers:
   if the candidate is not authorized in the job's country/region and needs sponsorship, we skip
   (`work_auth` / `remote_region`) instead of submitting an application that auto-rejects. Logic is
   mirrored between TS and Python.
3. **Seniority match → `seniority_mismatch`.** `extractSeniority(title)` maps to a 0–6 ladder; roles
   ≥2 levels from the candidate's level are skipped. Profile level is inferred from the resume
   (years of experience, then explicit title marker); unknown → check skipped.
4. **Fit threshold (`jobfit_min_score`, currently 65).** Recommendation: **keep 65 for now.** We
   cannot compute a replied-vs-ignored fit distribution yet — only 22/227 historical apps were
   scored and there are 0 interviews + the human replies are rejections on pre-fix (broken-contact)
   apps. Revisit once we have clean post-fix data with replies.

### Funnel instrumentation (already largely in place; gap closed)
- Status lifecycle: `app/api/inbox/inbound/route.ts` already sets `JobApplication.status` →
  INTERVIEW / REJECTED from inbox classification, with company matching. (TODO: SILENT after 21d.)
- Telegram: notifier `interview_reply` fires on every INTERVIEW_REQUEST (the "aha"). 
- **Added** a celebratory interview banner on the dashboard (`app/dashboard/page.tsx`) and the
  `/admin/pmf` funnel row (Prompt 09).

### Rollout
- Feature-flagged `targeting_v2` (FeatureFlag). **Enabled** so the seniority knockout takes effect
  immediately (stops Director/Manager misapplies for an IC profile). The `remote_region` knockout
  only fires when the eligibility profile is honest (see below).
- 45 unit tests in `__tests__/lib/eligibility.test.ts` (16 region cases incl. "Remote — US only",
  "Remote (EMEA)", "anywhere", timezone, plain-remote→null; seniority; v2 knockouts; legacy off).

## ⚠️ The profile-honesty dependency (needs a product decision)
`remote_region` / `work_auth` only protect conversion when the eligibility profile is **honest**.
The active campaign currently has a broad profile (authorizedCountries incl. United States,
`needsVisaSponsorship=false`, `willingToRelocate=true`) — set earlier to maximize reach. For an
Australian candidate with no US work authorization, that profile both (a) makes the region knockout
a no-op and (b) means screening answers claim US authorization that recruiters will reject. **The
single biggest remaining conversion lever is setting an honest profile** (real authorized countries
+ truthful sponsorship). This requires the candidate's real work-authorization data — not something
to invent. Until then, `targeting_v2` mainly enforces the seniority gate.

## Metric to watch
**Interview rate per 100 verified submissions, counted only on post-2026-06-10 (contact-fixed),
eligible, tailored applications.** Visible on `/admin/pmf` (Funnel row) + `scripts/funnel_report.ts`.
Honest expectation: first recruiter replies within days; interviews within 2–3 weeks at ~2–5% on
eligible, tailored applications.

## Deferred (TODO, larger than this pass)
| Item | Effort |
|------|--------|
| Worker page-level screening dry-run (read the actual ATS questions, simulate honest answers, skip pre-submit) | ~4h |
| Application QA gate (reject run if tailored resume lacks quantified bullets / wrong company in cover letter / wrong contact email) | ~4h |
| Per-application proof storage (final screening answers + submission screenshot path) | ~3h + storage |
| SILENT(>21d) status transition + per-campaign funnel UI + WoW admin trend | ~4h |
