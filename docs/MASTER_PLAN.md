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

- [x] **P0.1 Smoke script** (`scripts/smoke.sh` + post-deploy CI job): homepage
      200, pricing 200, login 200, containers up, no recent web errors.
      DONE 2026-07-16 (PR #125; `npm run smoke`; also placed on VPS at
      /opt/resumeai/scripts/smoke.sh). NOTE: the deploy.yml wiring (scp sync +
      external verify job) is parked on local branch `ci/smoke-verify-job-local`
      — the deploy token lacks the GitHub `workflow` scope (see OWNER ACTIONS).
      Until then deploys keep using the embedded legacy heredoc checks.
- [x] **P0.2 Product analytics**: DONE 2026-07-16 (PR #126) via the existing
      first-party layer (AnalyticsEvent + page_view tracker) instead of adding
      Plausible/PostHog — VPS is memory/disk-tight and the in-house layer
      already tracks pageviews/UTM/visitors. Funnel defined once in
      `lib/pmf/user-funnel.ts` (+ `signup` event in auth). Revisit PostHog at
      scale per docs/ARCHITECTURE.md ($5k MRR).
- [ ] **P0.3 Google Search Console + sitemap**: sitemap live (102 URLs incl.
      79 programmatic SEO pages), robots.txt correct — verified 2026-07-16.
      REMAINING (owner): GSC property access -> confirm indexation + record
      baseline impressions/clicks here.
- [x] **P0.4 Error alerting**: DONE 2026-07-16 (PR #127). Web
      (instrumentation.ts onRequestError) + worker (FastAPI exception handler)
      -> admin_alert on Redis -> founder Telegram. Live-verified end-to-end:
      test alert published on prod, notifier logged admin_alert.sent
      (Telegram accepted delivery).
- [x] **P0.5 Weekly metrics snapshot**: DONE 2026-07-16 (PR #126).
      `funnel_report.ts` leads with acquisition funnel + week-2 retention;
      founder email Mondays 09-12 UTC via the hourly digest cron (deduped);
      needs ADMIN_EMAILS env (present in prod).

**Exit:** every funnel step measurable; one-command smoke test; alerts on errors.

## REVENUE SPRINT (Session A — money path, runs before Phase 1)

Goal: a stranger landing on any page can pay us money today, through a
low-friction tripwire, and every step is measured.

- [x] **A1 Verify + fix the existing payment path.** DONE 2026-07-17.
      - Audited stripe libs/routes; deleted legacy raw-priceId checkout route;
        create-checkout-session accepts plan slug + interval only (PR #129)
      - Stripe reconciled LIVE: sk_live key; Pro $19/mo
        (price_1TtnFH...jK8Np3qf) + $180/yr (price_1TtnFH...DCWqdAM6) active
        and wired via env; pricing page/FAQ/JSON-LD unified to $19/$180;
        Unlimited hidden (PR #129); stale Stripe product description
        replaced with honest copy (API, 2026-07-17)
      - Funnel events live: checkout_started, checkout_completed,
        checkout_abandoned (checkout.session.expired subscribed)
      - LIVE $0-promo checkout evidence (2026-07-17): promo A1VERIFY (100%
        off, single-use) -> real prod checkout completed with no card
        (payment_method_collection if_required) -> webhook processed ->
        User row: sub sub_1TtzTk..., $19 price, dailyApplicationLimit 25,
        firstPaidAt set -> events signup/checkout_started/checkout_completed
        recorded -> sub canceled, coupon deleted, promo deactivated
      - Found + fixed live: invoice.payment_succeeded read the invoice id
        as a subscription id and crashed on every renewal (PR #130)
- [ ] **A2 Tripwire product — "AI Resume Rescue" ($4.99 one-time).**
      /resume-rescue: paste job URL/title + upload resume -> Stripe Checkout
      (one-time, guest, auto-account) -> tailored resume (all 5 templates)
      + fit report -> result page + email <5 min; auto-refund + apology +
      founder alert on generation failure; upsell "Pro first month $9"
      (single-use coupon, 72h); events tripwire_view/paid/delivered,
      upsell_accepted; cost guard: 1 regen max, cache (resume_hash, job_hash).
- [ ] **A3 CTA wiring.** Contextual CTA on all ~79 SEO pages + FAQ/blog:
      primary "Fix my resume for this job — $4.99", secondary "Start free".
      Product+Offer JSON-LD on /resume-rescue.
- [ ] **A4 Trust minimum.** Founder block (real name, photo placeholder,
      why-note), support email + /contact, refund policy linked next to every
      price, replace "321 live totals" with /proof link + real ATS
      confirmation screenshot.

**Exit:** watch a $0-promo live purchase of both Pro and the tripwire complete
on prod with all funnel events recorded; failed generation auto-refunds; all
deploys smoke-green.

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

## REVENUE SPRINT (Session A — money path, inserted 2026-07-16)

Goal: a stranger landing on any page can pay us money today, through a
low-friction tripwire, and every step is measured.

- [ ] **A1 Verify + fix the existing payment path**: audit stripe libs/routes;
      Stripe LIVE mode + price reconciliation via API (read-only); fix pricing
      inconsistency (final: Free / Pro $19 per month, annual $180 secondary,
      Unlimited hidden until demand); funnel events checkout_started /
      checkout_completed / checkout_abandoned; live $0-promo checkout test on
      prod with evidence; auto-refund path N/A here (see A2).
- [ ] **A2 Tripwire — "AI Resume Rescue" ($4.99 one-time)**: /resume-rescue
      page -> paste job URL/title + upload resume -> Stripe Checkout (one-time,
      guest ok, account auto-created from email) -> tailored resume (all 5
      templates for this resume) + fit report (jobfit + critique) delivered
      <5 min via result page + email; failure -> auto-refund + apology +
      founder alert; post-purchase upsell "Pro first month $9" (single-use
      coupon, 72h); events tripwire_view/paid/delivered/upsell_accepted;
      cost guard: 1 regeneration max, cache by (resume_hash, job_hash).
- [ ] **A3 CTA wiring**: contextual CTA block on all ~79 SEO pages + FAQ
      (primary: "Fix my resume for this job — $4.99"; secondary "Start free");
      Product+Offer JSON-LD on the tripwire page.
- [ ] **A4 Trust minimum**: founder block (name, photo placeholder, why-note),
      support email + /contact linked in footer, refund policy next to every
      price, replace absolute live counters with /proof link + one real ATS
      confirmation screenshot.

**Exit:** watch a $0-promo live purchase of both Pro and the tripwire complete
on prod with all funnel events recorded; failed generation auto-refunds; all
deploys smoke-green.

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

## OWNER ACTIONS (blocked on Maxim)

1. **GitHub workflow scope** — run `gh auth refresh -h github.com -s workflow`
   (interactive browser flow), then push branch `ci/smoke-verify-job-local`
   and open/merge its PR. Unblocks: deploy gate using canonical smoke.sh +
   external post-deploy verify job (P0.1 tail).
2. **Google Search Console** — confirm the resumeai-bot.ru property, submit
   /sitemap.xml if not already, and share baseline impressions/clicks for the
   P0.3 checkbox.
3. **Telegram alerts** — ADMIN_TELEGRAM_CHAT_ID is set to your chat id
   (6246429438). If you have never pressed Start on the ResumeAI bot, do it
   once or Telegram refuses bot-initiated messages (403).
4. **Phase 1 prep** — buy the .com/.ai domain (P1.1).

## LOG

- 2026-07-16 — Plan created. Baseline: 0 real users, $0 MRR, 72 submitted / 0
  interviews, dogfood only. Prod verified healthy before starting Phase 0.
- 2026-07-16 — Phase 0 built in one session: P0.1 smoke.sh (PR #125), P0.2
  acquisition funnel + P0.5 weekly snapshot (PR #126), P0.4 error alerting
  (PR #127). P0.3 technical checks green; GSC numbers await owner. All
  deploys live-verified (smoke green, digest cron 200, containers healthy).
  Learned: VPS rate-limits per-IP connection bursts (smoke.sh designed around
  it); deploy token lacks workflow scope (owner action #1).
- 2026-07-16 — P0.4 live-verified: test admin_alert delivered to founder
  Telegram on prod (notifier logged admin_alert.sent). Phase 0 code complete;
  remaining Phase 0 items are owner actions (GSC numbers, workflow scope).
