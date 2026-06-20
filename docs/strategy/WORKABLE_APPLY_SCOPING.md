# Project scope — iframe-aware Workable apply (genuine volume unlock)

**Goal:** turn Workable's global job search (~24k jobs for "support") into a reliable,
*submittable* supply — the only proven lever to expand daily applications past the
direct-ATS (Greenhouse/Lever/Ashby) ceiling.

**Status:** scraper + handler built and merged, then **disabled** (`source_workable` flag
OFF) because the apply step is not yet reliable. This doc scopes the work to make it so.

## What already exists (foundation, dormant in repo)
- `worker/worker/scrapers/workable.py` — global search via
  `GET jobs.workable.com/api/v1/jobs?query={kw}`, cursor pagination (`pageToken`). Verified:
  ~200 fillable-source jobs/keyword, with `location`/`workplace` metadata for eligibility
  filtering. **This part works.**
- `careerops.apply_workable_view` — clicks "Apply now" on `jobs.workable.com/view/{id}` and
  fills the revealed form. Routed when the URL contains `jobs.workable.com/view`.
- `source_workable` FeatureFlag (currently `false`).

## Why it's not reliable yet (the hard problem)
Workable's inline apply behaves **differently per job**:
1. Some jobs reveal an **inline form on the main page** (fillable). ✅
2. Some render the form **inside an iframe** — our field-fill + submit selectors target the
   main page and miss it. `_fill_unanswered_required` already searches frames (so it fills
   *some* fields), but the resume upload + the submit button are main-page-scoped → the
   submit either isn't found or clicks a non-actionable duplicate. ❌
3. Some "Apply now" buttons go to an **external ATS / require login** — not fillable. ❌

Net: a single handler that assumes the main page fails on (2) and (3).

## Proposed implementation
1. **Frame detection.** After clicking "Apply now", locate the frame that contains the apply
   form (`input[name="firstname"|"name"]` + a `button[type="submit"]`). Prefer an
   `apply.workable.com` iframe if present. Operate via Playwright `frame_locator` / the
   `Frame` handle for ALL fill + submit, not `page`.
2. **Classify & bail fast.** If no apply form appears in any frame within ~6 s (external/login
   case), return `form_not_found` quickly so it never eats the run budget. (The current
   bounded clicks already prevent the 30 s hang.)
3. **Submit on the right control.** The inline form has two "Submit application" buttons (a
   `type=null` decoy + the real `type=submit`); always target `button[type="submit"]` within
   the form frame. (Already fixed for the main-page case.)
4. **Resume upload in-frame.** Re-point `_upload_resume` to the form frame's file input.
5. **Measure success rate** on a sample of ~50 Workable jobs (dry harness, NOT live spam):
   what % reach a confirmed submit. Enable `source_workable` only if ≥ ~40% submit cleanly,
   else keep gated.

## Guardrails
- **Memory:** Workable apply opens a heavy SPA per job — keep it under the existing worker
  `MAX_CONCURRENT_APPLIES` semaphore (2).
- **No test spam:** build a dry-run mode (fill + detect submit-readiness, do NOT click final
  submit) for the success-rate measurement.
- **Honesty:** keep the `_verify_submitted` gate — a Workable apply only counts when truly
  confirmed.

## Effort / risk
Medium build (iframe-aware rework of one handler + a measurement harness). Risk: Workable may
change its DOM; success rate is uncertain until measured. Upside: if it lands, daily
submittable supply jumps from "handful" to "hundreds/keyword" — the real volume unlock.

## What NOT to revisit
Third-party job boards (RemoteOK / WeWorkRemotely / Arbeitnow / Remotive / Himalayas /
Jobicy) — proven (4 ways) to hide the underlying ATS apply URL even from a headless browser.
They are a dead end for *submittable* volume; only useful as discovery signals, never apply
targets.
