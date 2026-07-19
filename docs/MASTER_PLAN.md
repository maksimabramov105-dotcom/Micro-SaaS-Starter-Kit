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
- [x] **A2 Tripwire product — "AI Resume Rescue" ($4.99 one-time).**
      SHIPPED 2026-07-17 (PRs #131 backend, #132 frontend, #135 promo codes).
      Full pipeline: guest checkout (paste/PDF, pre-payment extraction) ->
      webhook PAID + auto-account -> Redis-locked generation (cached tailor +
      fit report) -> Resume row (all 5 templates) + result page + delivery
      email; max 2 attempts then AUTO-REFUND + apology + founder alert; cron
      safety net; 72h "Pro first month $9" upsell; events
      tripwire_view/paid/delivered + upsell_accepted. Stripe live: product
      prod_UtnBdGNiLmTJ2Y, price price_1TtzbE... $4.99. Live $0 purchase
      verification: see LOG.
- [x] **A3 CTA wiring.** DONE 2026-07-17 (PR #133). RescueCtaBlock on all 4
      programmatic templates (~79 pages) + FAQ; StickyCta (all pages)
      repointed from the retired "50+ countries/LAUNCH40" claim to the
      tripwire; Product+Offer JSON-LD live on /resume-rescue (#132).
- [x] **A4 Trust minimum.** DONE 2026-07-17 (PR #134). Absolute counters
      replaced with the /proof verified-ledger block; founder note (name,
      initials avatar, why, support email <24h); footer email; refund policy
      linked next to every price; JSON-LD claim cleanup. OWNER assets still
      wanted: founder photo + one permissioned real ATS-confirmation
      screenshot (lib/proof.ts stays empty until then — no fake proof).

**Exit:** watch a $0-promo live purchase of both Pro and the tripwire complete
on prod with all funnel events recorded; failed generation auto-refunds; all
deploys smoke-green.

## SESSION B — SEO flywheel: autonomous page factory + indexing (~1-2 days)

Goal: the site autonomously grows indexable, conversion-wired pages targeting
long-tail job-search intent, and actively pushes them to search engines.
seo_health gate applies to every page (title <=65, description <=160).

- [x] **B1 Indexing automation.** DONE 2026-07-17. IndexNow key served from
      /public + lib/seo/indexnow.ts (full-sitemap push weekly, Mondays);
      daily seo-health check (all sitemap URLs fetched, founder Telegram
      alert on 404/5xx or broken sitemap) — both self-gated in the hourly
      digest cron (no new workflow possible: token lacks workflow scope) +
      manual POST /api/cron/seo-health; sitemap lastmod now a stable content
      date instead of request-time `now` (only /proof stays live); robots +
      canonical audit: all page types already correct, no fixes needed.
      NOTE: Google has no ping API since 2023 — Google discovery = sitemap
      lastmod + GSC (owner action).
- [x] **B2 Programmatic page factory v2.** DONE 2026-07-18 (PRs #139, #140).
      - Competitor pages: +jobscan +careerflow (10 total; all 9 targets
        covered). Honest rows only.
      - /apply-to/{company} x168 from the curated scraper lists (single
        source exported to lib/seo/apply-companies.json): per-ATS
        hand-written walkthroughs + tips, live open-roles from scraper
        cache via ISR 6h, HowTo/FAQ/Breadcrumb JSON-LD, contextual
        tripwire CTA, related-companies mesh, /apply-to hub.
      - /resume-keywords/{role} x12 + hub: keywords extracted by
        ai/keywords.py from REAL JobListing descriptions; roles ship only
        with >=2 genuine postings (grows automatically with the corpus —
        honest provenance over 50 recycled listicles; regen script:
        rolekw.py pattern documented in LOG).
      - REMAINDER: OG images for new templates (existing opengraph-image
        pattern) — with B4.
- [x] **B3 Data-driven blog engine.** DONE 2026-07-18. /blog + 2 posts whose
      stats sections compute LIVE from JobApplication/ApplicationEvent/
      InboxMessage under daily ISR (beats the planned monthly cron — zero
      cron needed); failure modes bucketed from real errorMessage data;
      graceful degradation if the DB blips (no 500s on marketing pages);
      Article JSON-LD + tripwire CTA + /proof cross-link.
- [x] **B4 Performance & crawl budget.** DONE 2026-07-18. Lighthouse
      (prod, mobile-throttled): landing 92/100, /resume-rescue 100/100,
      apply-to 92-100, resume-keywords 98/100, jobs-in 99/100 — SEO
      category 100 everywhere. All public pages static/ISR-rendered, no
      client-side data fetching. (Post-deploy cold-ISR runs can read
      ~85 until caches warm — re-measure warm.) REMAINDER (with a later
      pass): OG images for the new template families.

**Exit:** ~102 -> 300+ high-quality URLs, auto-pinged, conversion-wired,
Lighthouse green, seo-health cron alerting. New data-file entries become
pages with zero manual work.

## SESSION C — Autonomous funnel: capture -> nurture -> convert (~1 day)

Goal: visitors who don't buy immediately are captured and converted
automatically, zero manual action.

- [x] **C1 Lead magnet — gated fit check.** DONE 2026-07-18. /ats-check
      (aliased /fit-check) two-phase: instant score + 2 findings free, then
      email + explicit consent unlocks the full report (3 fixes) and enrolls
      the lead. Reuses ai/jobfit via the rate-limited public /api/ats-check
      (3/IP/day, worker secret server-side). RescueCtaBlock on all ~290 SEO
      pages links to it ("get a free fit score first"). Events:
      fitcheck_started, lead_captured.
- [x] **C2 Email nurture (Resend, founder voice, unsubscribe).** DONE.
      lib/nurture: t0 full report (inline at capture) -> +2d "3 fixes" ->
      +5d tripwire offer -> +9d data post + goodbye; stops on purchase
      (paid RescueOrder or paying User) or unsubscribe. Abandoned checkout:
      PENDING_PAYMENT 4-28h -> ONE reminder with the live Stripe session
      link. All due-based, driven from the hourly digest cron.
- [x] **C3 Funnel dashboard.** DONE. lib/pmf/revenue-funnel.ts:
      seo_visit -> fitcheck_started -> lead_captured -> tripwire_paid ->
      pro_subscribed + revenue split (tripwire one-time gross vs
      subscription MRR) + leads-in-nurture/suppressed. Wired into /admin/pmf
      (new section) and the Monday founder email.
- [x] **C4 Compliance minimum.** DONE. Explicit consent checkbox required
      before any email (server-enforced); privacy-policy link at capture;
      global EmailSuppression table honored everywhere (nurture, abandoned,
      re-capture); one-click HMAC unsubscribe -> /unsubscribed.

**Exit:** a cold visitor can be captured, nurtured, and converted to
tripwire -> Pro with zero manual action; every stage visible in the funnel
report. (Live $0 gated-capture + nurture-tick verification: see LOG.)

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
4. **Phase 1 prep** — buy the .com/.ai domain (P1.1). Now urgent: 290 URLs
   of SEO equity are accruing to resumeai-bot.ru — every week of delay is
   equity to migrate later.
5. **Dependabot holds** — decide on PR #107 (nodemailer 8->9 major; the
   magic-link login depends on nodemailer via next-auth — test sign-in
   after merging) and #102 (starlette bump; CI runs no worker tests, so
   merge + watch worker health or add a worker test job first).
6. **Trust assets** — founder photo for the landing block + one
   permissioned real ATS-confirmation screenshot for lib/proof.ts.

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
- 2026-07-17 — A2 LIVE $0 PURCHASE VERIFIED on prod: RESCUE100B (100% off,
  single-use) -> guest checkout completed card-free -> webhook marked PAID +
  auto-created account -> generation DELIVERED IN 22 SECONDS (budget: 5 min)
  -> result page rendered fit report 55/100 (breakdown, keywords, fixes) +
  all-5-template picker -> guest PDF download 200/17.7KB valid. Full event
  chain recorded: tripwire_view -> signup -> tripwire_paid ->
  tripwire_delivered. Found+fixed live: upsell coupon name exceeded Stripe's
  40-char cap, so no upsell promo was ever created (PR #136). Test promos
  deactivated, coupon deleted. $0 orders have no payment intent -> refund
  path no-ops correctly.
- 2026-07-18 — SESSION B COMPLETE. Sitemap 103 -> 290 URLs, every one
  conversion-wired with the tripwire CTA. B1 seo-health ran autonomously on
  its first cron cycle (103 URLs, 0 failures, no false alerts); after the
  keyLocation fix (PR #142, found live) IndexNow accepted the full 290-URL
  submission (200). B2: 168 /apply-to company guides + 12 corpus-backed
  /resume-keywords roles + 2 new competitor pages. B3: telemetry blog with
  live self-updating stats. B4: Lighthouse green everywhere (see checkbox).
  Dependabot: 6 of 8 stale PRs merged; #107 nodemailer major + #102
  starlette held for owner. All deploys smoke-green.
- 2026-07-17 — Webhook alert from the founder-Telegram screenshot resolved:
  the invoice.payment_succeeded crash (PR #130) was the pre-fix occurrence;
  Stripe's retry after deploy processed clean (pending_webhooks: 0, event id
  in StripeEvent). Dependabot: #104/#105/#106 merged (cryptography,
  form-data, dompurify); #109 rebasing; HELD for owner: #107 (nodemailer
  8->9 major — next-auth peer risk), #102 (starlette — CI runs no worker
  tests), #98 (sentry/otel — re-evaluating after rebase). js-yaml security
  job fails by design: advisory has no patched release yet.
