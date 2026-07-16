# MASTER PLAN — Distribution-First "Honest Job-Search Copilot"

Status doc for the strategic pivot (decided 2026-07-16). This file is the single
source of truth for phase progress. Update checkboxes + LOG after every task.

---

## Strategy (context)

The paid "auto-apply from our own catalog" model has a finite supply ceiling
(~150 curated ATS companies) and cannot reach revenue alone. New model:

1. **Free Chrome extension wedge** — autofill + tailoring + verified tracking on
   ANY job posting the user visits (user brings supply, like Simplify's model).
2. **Outcome-independent paid value** — reply inbox, fit reports, per-role resume
   tailoring, application analytics (what Teal/Jobscan monetize).
3. Backend auto-apply stays as a premium feature, NOT the core promise.

**Hard goals (in order):**
- **G1:** 100 real (non-dogfood) activated users. "Activated" = completed >=1
  tracked or submitted application.
- **G2:** first 10 paying customers.
- **G3:** $10k MRR (~500 subs at $19/mo, or mix with $49 tier).

**Decision gate:** if after full execution of Phases 0-4 + launch (Phase 5) there
are <100 activated users with near-zero week-2 retention, STOP feature work and
write a B2B-flip proposal (sell the ATS-automation engine to recruiters/staffing)
instead of continuing B2C.

**Freeze rule:** the apply engine (`careerops.py`) is in maintenance mode. Bug
fixes only. No new ATS handlers, no new scrapers, unless a phase below
explicitly requires it.

**Proven dead ends — do NOT re-attempt (see COWORK_BRIEF.md section 10):**
- Aggregator boards (RemoteOK/WWR/Himalayas/Arbeitnow/TheMuse/Adzuna) as apply
  targets — discovery only.
- Workable auto-submit (`source_workable` flag stays OFF unless re-verified
  manually).
- Chasing sustained 30/day volume from the curated catalog — supply comes in bumps.
- LinkedIn bulk auto-apply (ban risk).

---

## PHASE 0 — Baseline, measurement, safety net (~2-3 days)

- [ ] **P0.1 Smoke script** (`scripts/smoke.sh` + post-deploy CI job): homepage
      200, pricing 200, login 200, containers up, no recent web errors.
- [ ] **P0.2 Product analytics** (Plausible self-hosted or PostHog Cloud free):
      landing view -> signup -> onboarding complete -> first application ->
      subscription. Funnel definition in `lib/pmf/`.
- [ ] **P0.3 Google Search Console + sitemap** verified; ~79 SEO pages indexed;
      baseline impressions/clicks recorded here.
- [ ] **P0.4 Error alerting**: web+worker exceptions -> Telegram notifier channel.
- [ ] **P0.5 Weekly metrics snapshot**: extend `scripts/funnel_report.ts` to
      output signups, activations, D7 retention, MRR; wire to digest cron.

**Exit:** every funnel step measurable; one-command smoke test; alerts on errors.

## PHASE 1 — Trust & positioning (~1 week)

- [ ] **P1.1 Domain migration to .com/.ai** (owner buys domain; prep checklist in
      `docs/runbooks/domain-migration.md`: Caddy, 301s, NEXTAUTH_URL, OAuth
      callbacks, Stripe webhook, canonicals, sitemap, GSC).
- [ ] **P1.2 Reposition landing copy**: "honest job-search copilot" — tailored
      resume per role + apply assist on any job + verified tracking + one inbox.
      Auto-apply becomes a feature bullet. Remove unbackable claims.
- [ ] **P1.3 Fix empty-room signals**: replace absolute counters with non-count
      proof (real ATS confirmations from `/proof`, tailored-resume diff, demo).
- [ ] **P1.4 Pricing overhaul**: Free = 3 assisted apps/day + 1 tailored
      resume/day + inbox. Pro $19/mo ($15/mo annual): unlimited tailoring, 25
      auto-applies/day, all templates. Monthly first. 30-day guarantee prominent.
- [ ] **P1.5 Trust block**: founder name+photo+note, support email <24h, refund
      policy linked, contact in footer, privacy wording. Beta-for-testimonials.
- [ ] **P1.6 UI/usability pass**: consistent palette, WCAG AA, real screenshots,
      mobile audit, CTA above fold, truthful comparison vs alive competitors.

**Exit:** new domain live w/ redirects; copilot story on landing; pricing
unified; smoke green; Lighthouse >=90 on landing (perf + SEO).

## PHASE 2 — The wedge: Chrome extension MVP (~2-3 weeks)

- [ ] **P2.1 Audit `extension/`** + MVP scope: detect Greenhouse/Lever/Ashby,
      one-click autofill from profile, "tailor resume for this job" button,
      track application (source=extension).
- [ ] **P2.2 API surface**: `app/api/ext/*` (token auth, Redis rate-limits, CORS
      locked to extension ID).
- [ ] **P2.3 Free-tier limits enforced server-side** (`lib/quota.ts`).
- [ ] **P2.4 Chrome Web Store listing** + submit for review (owner account).
- [ ] **P2.5 Landing "Add to Chrome — free" primary CTA.**
- [ ] **P2.6 E2E test**: fixture pages for Greenhouse/Lever/Ashby autofill in CI.

**Exit:** extension approved; new user installs -> autofills a real Greenhouse
job -> sees it tracked in dashboard within 10 min of first visit.

## PHASE 3 — Outcome-independent paid value (~1-2 weeks)

- [ ] **P3.1 Wire per-job resume tailoring into backend apply path**
      (`autoapply/prepare` -> careerops TODO). Verify PDF via `/jobs/resume-pdf`.
- [ ] **P3.2 Fit report** ("why you're getting rejected"): `ai/jobfit.py` +
      `ai/critique.py` -> per-application report. Paid feature.
- [ ] **P3.3 Inbox polish**: classify replies (ack/rejection/interview/question),
      notify email+Telegram on non-ack. "0 fake applied" ledger front and center.
- [ ] **P3.4 Weekly user digest email** (Resend): applications, replies, fit tips.

**Exit:** a paying user gets weekly tangible artifacts regardless of interviews.

## PHASE 4 — Activation & onboarding (~1 week)

- [ ] **P4.1 Onboarding to first value <10 min**: upload resume -> AI parse ->
      prefilled profile -> 5 matching jobs or extension prompt -> first tailored
      resume same session.
- [ ] **P4.2 Empty states that sell** (dashboard at 0 applications shows next step).
- [ ] **P4.3 Email lifecycle** (Resend): welcome, day-1, day-3, day-7. Founder voice.
- [ ] **P4.4 In-app upgrade prompts** at quota edges; conversion tracked per prompt.

**Exit:** signup->activation >=40%; time-to-first-value <10 min median.

## PHASE 5 — Launch & distribution (continuous from P2 completion)

- [ ] **P5.1 (code) Referral loop**: give 1 month Pro, get 1 month.
- [ ] **P5.2 (code) Public proof page polish** (`/proof`) as marketing centerpiece.
- [ ] **P5.3 (code) Programmatic SEO round 2** on .com: "apply to jobs at
      {company}" + "X vs ResumeAI" comparison pages. Respect seo_health gate.
- [ ] **P5.4 (owner) Beta cohort**: 10-20 users, free Pro for feedback/testimonials.
- [ ] **P5.5 (owner) Product Hunt launch** (code: PH landing variant, banner, badge).
- [ ] **P5.6 (owner) Content channel**: 2 posts/week build-in-public + honest data.
- [ ] **P5.7 (code) A/B measure everything**: hero variants via `FeatureFlag` +
      `rolloutPct`, decided by analytics.

**Exit = G1:** 100 activated users. Then push conversion to G2/G3.

---

## Economics guardrails

- AI cost per user tracked; tailoring+cover letter per application < $0.05;
  cache aggressively (Redis) — same job+resume pair never generates twice.
- Free tier < $0.50/user/month AI spend; enforce via quotas.
- $10k MRR mix: ~400 Pro ($19) + ~40 at $49, or equivalent. MRR in weekly
  snapshot from Stripe data.

## What NOT to do

- No new ATS handlers/scrapers "for supply" — supply comes from users via the
  extension.
- No Workable re-attempts, no aggregator applies, no LinkedIn bulk botting.
- No dark patterns: no fake counters, no fake testimonials, no "applied" without
  ATS confirmation — honesty IS the brand.
- No full redesigns; iterate existing UI.
- Never commit secrets; never print full env values.
- Never mark a task done without live verification (COWORK_BRIEF section 7 +
  smoke).

## Session ritual

1. Read this file -> find first unchecked task.
2. `git pull`, run `scripts/smoke.sh` against prod, check last cron runs + alerts.
3. One task -> one PR -> deploy -> verify -> check off.
4. End of session: update checkboxes + status lines in LOG.

---

## Baselines (recorded 2026-07-16)

- Users: 0 real (dogfood only). MRR: $0.
- Applications all-time: 72 SUBMITTED / 161 FAILED / 7 REJECTED; 0 interviews.
- Prod health: all containers Up (db/redis/caddy 5 weeks, web/worker/notifier
  10 hours); smoke_test.sh all green; crons (run-campaigns, digest) succeeding.
- Web error logs (12h): clean. Worker (12h): benign scraper fetch warnings only.
- SEO baseline (GSC impressions/clicks): TBD in P0.3.

## LOG

- 2026-07-16 — Plan created. Baseline: 0 real users, $0 MRR, 72 submitted / 0
  interviews, dogfood only. Prod verified healthy before starting Phase 0.
