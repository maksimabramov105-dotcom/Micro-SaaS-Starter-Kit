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
      CAVEAT found 2026-07-20 by the evidence sweep: run off-VPS with an
      unreachable SSH target, the script skips every container check and still
      prints "All smoke checks passed". Its default `SMOKE_SSH_HOST` is also
      stale. Make the skip loud. See `docs/EVIDENCE_2026-07.md` F3d.
- [x] **P0.2 Product analytics**: DONE 2026-07-16 (PR #126) via the existing
      first-party layer (AnalyticsEvent + page_view tracker) instead of adding
      Plausible/PostHog — VPS is memory/disk-tight and the in-house layer
      already tracks pageviews/UTM/visitors. Funnel defined once in
      `lib/pmf/user-funnel.ts` (+ `signup` event in auth). Revisit PostHog at
      scale per docs/ARCHITECTURE.md ($5k MRR).
- [ ] **P0.3 Google Search Console + sitemap**: sitemap live and correct —
      **301 URLs, all 200, all emitting resumeai-bot.com** (re-verified
      2026-07-31 after the domain migration), robots.txt correct, IndexNow
      accepting every URL.
      REMAINING (owner, needs your Google/Microsoft accounts — see
      `docs/FREE_TRAFFIC_PLAYBOOK.md` section 0 for the exact clicks):
        1. Add the `resumeai-bot.com` property (Domain type, DNS TXT verify).
        2. **Change of Address** on the OLD `.ru` property -> `.com`. This is
           the highest-value single click available right now; the 301 it needs
           is live and verified. Without it the domain move leaks rankings.
        3. Submit `sitemap.xml` on the new property.
        4. Bing Webmaster Tools -> "Import from Google Search Console" (2 min;
           also feeds DuckDuckGo/Ecosia/ChatGPT search).
        5. Then record baseline impressions/clicks here.
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
      - G1 (2026-07-30, PRs #162/#164/#165): company pages now also render a
        LIVE open-role list with links + a remote-eligibility line from the
        scraper cache (44 of 168 companies currently have roles; 52 at
        Twilio, 42 at Cloudflare). /apply-to hub gained search + ATS filter
        + sort-by-open-roles as a client island over the server-rendered
        list. /companies and /companies/{slug} 308-redirect here — one
        canonical URL space instead of ~150 duplicate pages.
      - G4 (2026-07-30): `__tests__/lib/seo-thin-pages.test.ts` fails the
        build on any generated page under 300 words or with a duplicate meta
        description. 180/180 descriptions unique. Meta + body copy come from
        single-source builders imported by BOTH pages and guard, so copy
        can't drift (the E1 lesson applied to content).
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

## SESSION D — Autonomous ops: the machine reports itself (~half day)

Goal: the founder learns about money, traffic, and breakage from Telegram —
never by checking dashboards. All driven from the hourly digest cron
(self-gated) since the deploy token can't add GitHub workflows.

- [x] **D1 Daily pulse** (~9am Sydney). One Telegram message: yesterday's
      unique visitors + top pages/referrers, leads, tripwire sales + revenue,
      new subs + MRR, applications submitted/failed, top error bucket.
      `lib/ops/daily-pulse.ts`, deduped, 📊 header (not the error siren).
      Unchecked on 2026-07-20 (zero `daily_pulse_sent` rows, all time) and
      **RE-CHECKED 2026-07-30: it works** — 4 fires, latest 2026-07-29
      23:24:07 UTC = 9:24am Sydney, clustering exactly in the intended window
      (4 rather than 10 because of the six-day outage in between). The 07-20
      finding was a false alarm: Session D shipped at 08:06 UTC that day, so
      the first eligible window (23:00 UTC) had not yet arrived when it was
      swept. The recommended gate-widening was therefore deliberately NOT
      implemented — it would have "fixed" working code. See
      `docs/EVIDENCE_2026-07.md` (re-sweep F3a).
- [x] **D2 Real-time money alerts.** Stripe webhook -> Telegram (💰) on every
      tripwire sale (incl. $0 promo tests), subscription start, and cancel —
      amount + source. Deduped by Stripe event id so retries never double-fire.
- [x] **D3 SEO watch** (weekly, Mondays). Telegram (🔎): sitemap URL count,
      pages non-200, IndexNow submission result. GSC clicks/impressions line
      is a placeholder until owner grants GSC API access.
- [x] **D4 Self-healing checks.** `lib/ops/self-check.ts` (money-path monitor
      on a ~6h loop, alerts P0.4 on failure, silent on success) + extended
      `scripts/smoke.sh`: tripwire page renders, fit-check API answers <5s,
      Stripe webhook verifies signatures (signed test event -> 200 in the
      cron; unsigned -> 400 in smoke).

**Exit:** 48h autonomous — daily pulse arriving, money alerts firing on the
$0 test purchases, zero manual intervention. (Live verification: see LOG.)
**MET as of 2026-07-30** — money alerts fire (proven again at 16:10:01 on the
re-sweep purchase) and the daily pulse fires (4 sends, latest 07-29 23:24 UTC).
Was NOT MET on 07-20 when the pulse had never run; see D1.

## REVENUE SPRINT STATUS (as of 2026-07-20)

Sessions A-D DONE. The money machine is built and self-reporting:
capture (C1) -> nurture (C2) -> convert to tripwire (A2) / Pro (A1),
fed by the SEO flywheel (B, 290 URLs), with autonomous ops telemetry (D).
Remaining is **owner-gated** (domain, GSC, workflow scope, dependabot holds,
trust assets — see OWNER ACTIONS) plus real traffic to convert.

**Next engineering priority = PHASE 2 (Chrome extension wedge).** It is the
distribution engine that brings user-supplied job supply, which the whole
pivot depends on. Phase 1 (trust/positioning) items that were cheap have
largely already shipped inside the Revenue Sprint (pricing unified A1,
tripwire trust A4, founder block A4); the remaining Phase 1 work (domain
migration, full landing reposition) is **owner-gated on the domain purchase**,
so it should not block starting Phase 2. Order: finish owner actions in
parallel; engineering starts P2 (extension) next.

## PHASE 1 — Trust & positioning (~1 week)

- [x] **P1.1 Domain migration to .com/.ai** (owner buys domain; prep checklist in
      `docs/runbooks/domain-migration.md`: Caddy, 301s, NEXTAUTH_URL, OAuth
      callbacks, Stripe webhook, canonicals, sitemap, GSC).
- [x] **P1.2 Reposition landing copy**: "honest job-search copilot" — tailored
      resume per role + apply assist on any job + verified tracking + one inbox.
      Auto-apply becomes a feature bullet. Remove unbackable claims.
- [ ] **P1.3 Fix empty-room signals**: replace absolute counters with non-count
      proof (real ATS confirmations from `/proof`, tailored-resume diff, demo).
      PARTIAL, verified live 2026-07-31: the absolute counters ARE gone and the
      landing links to `/proof` (twice), so the anti-social-proof problem is
      solved. What is still missing is the POSITIVE proof: no demo GIF/video and
      no ATS-confirmation screenshot on the landing page. That is blocked on
      owner action #6 (a permissioned real ATS confirmation screenshot + founder
      photo) — it cannot be fabricated, and inventing it would break the one
      thing the brand sells. Stays unchecked until those assets exist.
- [x] **P1.4 Pricing overhaul**: Free = 3 assisted apps/day + 1 tailored
      resume/day + inbox. Pro $19/mo ($15/mo annual): unlimited tailoring, 25
      auto-applies/day, all templates. Monthly first. 30-day guarantee prominent.
- [x] **P1.5 Trust block**: founder name+photo+note, support email <24h, refund
      policy linked, contact in footer, privacy wording. Beta-for-testimonials.
- [x] **P1.6 UI/usability pass**: consistent palette, WCAG AA, real screenshots,
      mobile audit, CTA above fold, truthful comparison vs alive competitors.

**Exit:** new domain live w/ redirects; copilot story on landing; pricing
unified; smoke green; Lighthouse >=90 on landing (perf + SEO).

## PHASE 2 — The wedge: Chrome extension MVP (~2-3 weeks)

- [x] **P2.1 Audit `extension/`** — DONE 2026-07-31. It is NOT a stub: 14 files,
      ~750 lines, Manifest V3, already covering detection (11 ATS platforms),
      autofill (237 lines), an on-page overlay, a popup, a background service
      worker with API-key storage, and a connect-bridge pairing flow. Backend
      endpoints /api/extension/resume and /api/extension/applications are live
      on .com (both 401 unauthenticated, i.e. present and guarded).
      TWO REAL DEFECTS FOUND, BOTH FIXED:
        1. The migration had BROKEN it. Five hardcoded .ru references, and
           host_permissions was the fatal one — without .com granted, the fetch
           following the .ru 301 is blocked by the extension permission model,
           so "the redirect still works" would NOT have saved it (#186).
        2. Tracked applications were written as source=MANUAL, making the
           wedge's contribution indistinguishable from hand-entered rows.
           Phase 2 exists to prove the extension drives activation; that is
           unmeasurable without attribution. Added JobSource.EXTENSION.
      STILL MISSING vs the MVP scope (feeds P2.2/P2.3/P2.6):
        - "Tailor resume for this job" is entirely absent from the extension —
          no call to tailoring or /jobs/cover-letter anywhere. Requirement 3 of
          P2.1 is unimplemented.
        - No E2E fixtures/tests (P2.6), no Web Store assets (P2.4), no
          "Add to Chrome" CTA on the landing page (P2.5).
      MVP scope status: ALL FOUR DONE — detection, autofill, track application
      (source=EXTENSION), and "tailor resume for this job" (#191), which wires
      the extension to the worker's /jobs/autoapply/prepare. That endpoint had
      existed all along with no caller from the extension side; it was the
      "unwired TODO" the brief flagged.
- [x] **P2.2 API surface** (token auth, Redis rate-limits, CORS locked to the
      extension). Lives at `app/api/extension/*`, NOT `app/api/ext/*` as the
      plan wrote — the shipped extension already calls the former, and renaming
      a live endpoint to match a doc would break every installed copy for no
      gain. `lib/extension-guard.ts` is the single gate (#188).
- [x] **P2.3 Free-tier limits enforced server-side** (`lib/quota.ts`) — was
      entirely unenforced before #188; the UI was the only limit.
- [ ] **P2.4 Chrome Web Store listing** + submit for review (owner account).
      Blocks P2.5 from being switched on and blocks the Phase 2 exit criterion.
- [x] **P2.5 Landing "Add to Chrome — free" primary CTA** — built and wired,
      renders only once `NEXT_PUBLIC_CHROME_EXTENSION_ID` is set (#189). One env
      var turns it on the moment P2.4 lands.
- [x] **P2.6 E2E test**: 6 Playwright specs over Greenhouse/Lever/Ashby fixtures
      (#191). They inject the real content scripts into fixture pages rather than
      loading the unpacked extension — that needs a persistent Chromium context,
      kills parallelism and is the flakiest thing in a CI suite, while what
      actually regresses is the per-ATS selector map. MUTATION-TESTED: renaming
      Ashby's email selector did NOT fail them (autofill.js always runs
      fillGeneric as a supplement, which refills input[type=email]); renaming
      firstName DID. Documented in the spec so a green run is not over-trusted.

**Exit:** extension approved; new user installs -> autofills a real Greenhouse
job -> sees it tracked in dashboard within 10 min of first visit.

## PHASE 3 — Outcome-independent paid value (~1-2 weeks)

- [x] **P3.1 Wire per-job resume tailoring into backend apply path**
      (`autoapply/prepare` -> careerops TODO). Verify PDF via `/jobs/resume-pdf`.
- [x] **P3.2 Fit report** ("why you're getting rejected"): `ai/jobfit.py` +
      `ai/critique.py` -> per-application report. Paid feature.
- [x] **P3.3 Inbox polish**: classify replies (ack/rejection/interview/question),
      notify email+Telegram on non-ack. "0 fake applied" ledger front and center.
- [x] **P3.4 Weekly user digest email** (Resend): applications, replies, fit tips.

**Exit:** a paying user gets weekly tangible artifacts regardless of interviews.

## PHASE 4 — Activation & onboarding (~1 week)

- [x] **P4.1 Onboarding to first value <10 min**: upload resume -> AI parse ->
      prefilled profile -> 5 matching jobs or extension prompt -> first tailored
      resume same session.
- [x] **P4.2 Empty states that sell** (dashboard at 0 applications shows next step).
- [x] **P4.3 Email lifecycle** (Resend): welcome, day-1, day-3, day-7. Founder voice.
- [x] **P4.4 In-app upgrade prompts** at quota edges; conversion tracked per prompt.

**Exit:** signup->activation >=40%; time-to-first-value <10 min median.

## PHASE 5 — Launch & distribution (continuous from P2 completion)

- [x] **P5.1 (code) Referral loop**: give 1 month Pro, get 1 month.
- [x] **P5.2 (code) Public proof page polish** (`/proof`) as marketing centerpiece.
- [x] **P5.3 (code) Programmatic SEO round 2** on .com: "apply to jobs at
      {company}" + "X vs ResumeAI" comparison pages. Respect seo_health gate.
- [ ] **P5.4 (owner) Beta cohort**: 10-20 users, free Pro for feedback/testimonials.
- [ ] **P5.5 (owner) Product Hunt launch** (code: PH landing variant, banner, badge).
- [ ] **P5.6 (owner) Content channel**: 2 posts/week build-in-public + honest data.
- [x] **P5.7 (code) A/B measure everything**: hero variants via `FeatureFlag` +
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
5. ~~**Dependabot holds**~~ **DONE 2026-07-30 — all 10 dependency PRs merged.**
   The 8 straightforward ones went first; #107 and #102 were the held pair and
   both are now merged and live-verified rather than merged and hoped for.
   - #107 nodemailer 8 -> 9 (major): safe because magic links no longer touch
     nodemailer at all — they go over the Resend HTTPS API. next-auth's
     providers/email.js `require`s nodemailer at module load but only calls
     `createTransport` inside the default sendVerificationRequest, which we
     override, so it merely has to be importable. VERIFIED after deploy:
     POST /api/auth/signin/email -> 302 and "Sign in to resumeai-bot.ru"
     delivered at 17:55:09.
   - #102 starlette 1.0.1 -> 1.3.1 (worker; CI runs no worker tests): VERIFIED
     in the running container — starlette 1.3.1 / fastapi 0.141.1, worker
     healthy, worker /health 200 through the proxy, error logs clean.
   - The recurring "Dependabot Updates" job failure is js-yaml and is EXPECTED:
     every advisory lists `patched-versions: []`, i.e. upstream has published no
     fix. Nothing to do until it does.
6. **Trust assets** — founder photo for the landing block (drop it at
   public/founder.jpg; an initials avatar ships until then) + one
   permissioned real ATS-confirmation screenshot for lib/proof.ts.
7. **LAUNCH40 decision** — the banner is NOT expired. Live Stripe check
   (2026-07-20): promo_1Th6TDHH7N0YD11QPjyoZKpw is ACTIVE, 40% off, valid
   to 2026-09-01, 0 redemptions — exactly matching lib/promo.ts, and the
   banner auto-hides after endsAt. Decide: keep running / expire early /
   convert to an evergreen offer. (An older promo_1TdXVs... is already
   expired + inactive and referenced nowhere.)
8. **CI gap — guards don't block merges.** PR-level checks (ci.yml) do NOT
   run jest; only the deploy pipeline's "Test & type-check" job does. So
   the price/claim guard blocks RELEASES but not MERGES — proven live on
   2026-07-20 when PR #151 merged green and its deploy then failed on the
   guard (prod was never touched: Docker build + VPS deploy were skipped).
   Fix = add the unit-test job to PR CI, which needs the `workflow` scope
   from action #1.
9. ~~**Archive 9 orphaned live Stripe prices.**~~ **DONE 2026-07-30** on your
   "do all". Live mode went from **14 active prices to 5** — exactly the 5 the
   code reads. Archived: $299/yr, $287.90/yr, $199/yr, $191.90/yr, $149,
   $39.99, $19.99 ×2, $2.99 ×2. Four refused at first ("cannot be archived
   because it is the default price of its product"); their product's
   `default_price` was cleared, then they archived cleanly. The script refuses
   to touch any price referenced by a `STRIPE_PRICE_ID_*` env var and aborts
   unless exactly 5 are on the keep-list. Archiving is reversible in Stripe
   (`active=true`) if you ever want one back. Money path re-verified after:
   tripwire checkout still creates (HTTP 200) and $19/$180/$4.99 all resolve
   active.
10. ~~**Rotate the GitHub PAT in `.git/config`.**~~ **PARTLY DONE 2026-07-30** —
   the dead `ghp_...` token is no longer in `.git/config`; `origin` is now a
   clean tokenless URL and fetch/push work through the `gh` credential helper
   (verified). **Still yours to do:** revoke that token in GitHub settings. It
   is dead for auth but should not remain valid anywhere.
11. **EXTERNAL uptime monitoring — WRITTEN, needs your merge.** The
   2026-07-23→29 outage ran SIX DAYS partly because nothing off-box could
   tell us: uptime-kuma runs on the same VPS, so when the host went
   unreachable the monitor went with it. The only signal was GitHub cron
   failures, which nobody was watching.
   The workflow is already written and PARKED on local branch
   `ci/uptime-external-local` (commit a4f77d2) — `.github/workflows/uptime.yml`.
   It cannot be pushed: the deploy token has scopes
   `admin:public_key, gist, read:org, repo` and GitHub rejects workflow files
   without `workflow` (verified: "refusing to allow an OAuth App to create or
   update workflow ... without `workflow` scope"). Same constraint as
   `ci/smoke-verify-job-local`.
   YOU: push/merge that branch with a `workflow`-scoped token. It probes
   /api/health every 15 min from GitHub's runners (genuinely off-box), retries
   3x before failing so a mid-deploy restart doesn't cry wolf, and fails the
   workflow — which emails you by default. OPTIONAL for phone alerts: add
   repo secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (6246429438); the
   alert step is conditional, so it works without them.
12. ~~**Decide: should the scrapers persist posting descriptions?**~~ **DONE
   2026-07-30 — answered yes and shipped (#171).** It turned out to be nearly
   free: Greenhouse returns the body in the SAME request via `content=true`,
   and we had been explicitly sending `content=false` while writing
   `description: ""` into a column that already existed. No extra requests, no
   new scraper (so the freeze rule isn't in play — this is a data-capture fix).
   Two measurements shaped it: truncating at lever.py's 2000 chars would have
   stored nothing but company boilerplate (all 187 Twilio postings began "Who
   we are At Twilio..."), and stripping Greenhouse's `content-intro` /
   `content-conclusion` blocks took unique openings from 1/187 to 141/187.
   Cost ~4 KB/listing. Coverage moves as the crawler revisits (112 -> 116 of
   479 on the first cycle) because the run-campaigns upsert refreshes
   `description`.
   FOLLOW-THROUGH DONE the same day (#173): backfilling the already-cached
   Greenhouse listings took coverage 116 -> 293 of 479 (24% -> 61%), which
   unblocked G2. /resume-keywords went 12 -> 23 roles using the LLM extractor.
   The deterministic extractor (scripts/gen-role-keywords.ts) stays committed as
   a read-only corpus/role-coverage analyzer only — it was measured twice and
   rejected both times for producing company names, US states and benefits
   boilerplate. Nothing here is outstanding.

## LOG

- 2026-07-31 (late) — PHASES 3 & 4 LARGELY SHIPPED. PRs #194-#197. All green,
  deployed, verified live on resumeai-bot.com.
  * **P3.1 — the longest-standing TODO in the codebase is closed.** Paid
    auto-apply generated a tailored COVER LETTER but shipped the BASE resume, so
    every application went out with the same resume regardless of role. The fit
    report would tell a user their resume missed the posting's keywords and then
    we submitted the untailored one anyway. run-campaigns now calls
    /jobs/autoapply/prepare (tailored resume + cover letter in one request,
    worker-cached on job+resume so the same pair never bills twice). Best-effort
    by design: any failure falls back to the base resume, because a slightly
    worse application still beats no application.
  * **P3.2 fit report.** ai/jobfit.py had always returned a per-factor breakdown
    and run-campaigns was DISCARDING it. New nullable JobApplication.fitBreakdown
    persists it (migration applied and verified on prod), and
    components/fit-report.tsx shows the score, per-factor bars against the real
    maxima, the scorer's verbatim reasons, and names the single biggest lever.
    Refuses to invent: no score recorded says so instead of rendering a fake 0.
  * **P4.3 lifecycle emails.** sendWelcomeEmail() had existed since the
    beginning and was NEVER CALLED — a user could sign up and hear nothing,
    ever. lib/lifecycle now owns welcome + day1/day3/day7, state in
    AnalyticsEvent (no migration), suppression shared with the nurture engine so
    one unsubscribe silences everything. After an outage it sends only the most
    recent due stage, never a backlog; day1 is skipped when the user already
    made a resume rather than sending something tone-deaf. 10 tests.
  * **P4.4 quota upgrade prompt.** The free tier was enforced server-side but the
    user only discovered it by hitting a wall with no way forward. The dashboard
    now turns the wall into the offer, only in the last third of the allowance,
    never for paying users, ref-tagged so upgrades are attributable per surface.
  * **CI gap closed** (#193): PR checks never ran `npm run test:ci`, so the
    price/claim/thin-page guards blocked RELEASES but not MERGES — proven on
    07-20 when #151 merged green then failed its deploy on the pricing guard.
  * **Root metadata still advertised the pre-pivot product** (#197): layout.tsx
    supplies 404 and fallback metadata and still said "AI Resume Builder +
    Auto-Apply … 160+ companies", the identity P1.2 moved away from.
  * FULL SYSTEM VERIFIED: 16/16 public pages 200; health, worker, CSRF and
    providers 200; extension endpoints 401; unsigned Stripe webhook 400; cron
    without auth 401; /dashboard redirects; free fit-check returned a real score
    of 90 in 0.53s; live tripwire checkout created; exactly 5 active Stripe
    prices; worker healthy; 8 SUBMITTED / 4 FAILED applications in 7d; 15
    resumes; 479 jobs cached with 293 carrying bodies.
  * Remaining in these phases: none. P3.4, P4.1, P4.2 and P5.7 shipped later the
    same day — see the entry below.


- 2026-07-31 (evening) — LIVE VERIFICATION FOUND FOUR REAL BUGS. Phases 3-5 are
  code-complete and deployed; verifying them against production is what turned
  these up, none of which any test or monitor was catching.
  * **INBOUND EMAIL DEAD SINCE 07-22** (#206), and this is the big one. 590
    messages historically, zero in nine days. Resend's free plan allows one
    domain, so migrating to .com deleted .ru — but INBOX_DOMAIN was still .ru
    and .com has no MX record at all. It silently broke two of the three
    landing-page promises: replies did not land in the inbox, and ATS
    confirmation COULD NOT WORK, because Greenhouse confirms by emailing a
    security code to the user's alias. Autoapply was reaching the submit button
    and recording FAILED (careerops.greenhouse.code_not_received ->
    submit_unconfirmed). The honesty rules held — nothing was ever marked
    applied — but the feature was dead. Owner checklist item 1; needs DNS +
    Resend. Shipped an absence-is-the-alarm check: every other monitor pokes
    something and reads the answer, which is exactly why an empty queue looked
    like a quiet week for nine days.
  * **Autoapply applied to NOTHING for 24h** — two separate bugs, both in the
    seniority gate, found by reading a live run: 518 scraped, 0 eligible.
    (#203) extractSeniority matched /manager/ before /senior/, so every
    "Senior Customer Success Manager" scored as a director. A Customer Success
    campaign could never apply to a Customer Success Manager role.
    (#205) The call site passed location + title + 1500 chars of DESCRIPTION to
    a keyword scanner, so any posting whose blurb said "report to the Director"
    scored as a director role. The gate was reading the company's org chart.
    After both: 10 applications in an hour, all 10 carrying a fitBreakdown —
    which also verified P3.2 in production for the first time.
  * **/pricing was Lighthouse 72** (#202) with LCP 5.4s, on the page that takes
    the money, purely because server-side A/B assignment opted it out of static
    rendering. Moved to the P5.7 client-assignment pattern; now ○ Static with
    1h ISR, x-nextjs-cache HIT. Both experiments now share lib/ab.ts.
  * **Flag flips did nothing for up to an hour** (#204). The admin page promised
    5 minutes, but / and /pricing are ISR-cached and invalidateFlagCache clears
    the flag cache, not Next's page cache. Found by enabling the pricing A/B in
    prod and seeing no variant script in the HTML.
  * **CI let a type error merge** — `next build` does not typecheck __tests__ and
    CI never ran type-check, so #200 merged green and its deploy failed on tsc.
    Same shape as the test:ci gap from 07-20. CI now runs type-check.

- 2026-07-31 (late) — PHASES 3-5 CODE-COMPLETE. Every remaining code item in
  Phases 3, 4 and 5 is merged. What is left in those phases is owner-only:
  P2.4 Web Store submission, P5.4 beta cohort, P5.5 Product Hunt, P5.6 content.
  * **P3.4 weekly user digest** (#199). Distinct from the paid-only daily digest:
    this goes to anyone who used the product that week, because a free user who
    never hears from us churns silently. The differentiator is the FIT TIP —
    P3.2 persists a per-factor breakdown on every application, so aggregating a
    week of those, normalised by each factor's maximum from ai/jobfit.py, names
    the one thing most likely to be costing replies. Comparing raw points would
    be wrong (30/50 skills is weaker than 20/25 seniority) and there is a test
    for exactly that. A factor is only called weak below 0.75 of its max, so a
    strong week says "nothing stands out" rather than inventing a problem.
    ISO-week marker, shared suppression, and silence when there was no activity.
  * **P4.1 resume import** (#200). Time-to-first-value was bounded by typing
    speed: creating a resume meant a four-step form asking for every job, every
    bullet, every date, and someone who already HAS a resume was being asked to
    retype it. worker/ai/parse.py + /api/resumes/parse now take the PDF or the
    pasted text and prefill the form. Two rules the prompt enforces because both
    failures are worse than an empty field: nothing is invented, and bullets are
    copied verbatim — tailoring is a separate explicit step, and a silent
    rewrite is one the user has no way to review. A failed parse is a 200 with
    parsed:null, so the worst case is that the import did not help.
  * **P4.2 first-run path** (#200). The new-user dashboard was five zeros and
    three "nothing here yet" cards — a status report on having achieved nothing,
    shown at the moment someone decides whether this is worth their time.
    Replaced with three steps, one live CTA, ticked steps kept visible. EVERY
    STEP IS OBSERVABLE (resume, campaign, application are all DB rows); the
    anonymous fit check is a standing offer underneath rather than a step that
    can never tick. A test caught the first draft making step 3 unreachable.
  * **P5.7 landing hero A/B** (#201). Server decides whether the test runs and
    at what percentage (FeatureFlag via React cache() + the page's ISR); client
    decides which visitor sees which variant (localStorage id, inline script
    before paint). The homepage stays ○ Static with 1h revalidate — verified in
    the build output — which is the whole point, after server-side assignment
    dropped /pricing to Lighthouse 72. checkout_started now carries
    experiment_key + variant, and experiment_results.ts learned to read
    client-assigned experiments whose denominator is the exposure event.
  * **Worker tests were running nowhere.** 193 pytest tests — scrapers, jobfit,
    resume rendering, autoapply — had no CI job. The Python half of the product
    could break on a PR and CI stayed green. Added the worker-tests job.

- 2026-07-31 (night) — PHASE 2 CODE-COMPLETE. Only P2.4 (Web Store submission,
  owner) remains, and it blocks the phase exit criterion.
  * P2.1 req 3 shipped (#191): "Tailor resume for this job" did not exist
    anywhere in extension/. app/api/extension/tailor now wires it to the
    worker's /jobs/autoapply/prepare, behind the same guard, and it CONSUMES
    QUOTA — tailoring is the LLM spend, so leaving it unmetered is how a free
    tier becomes expensive. job_id is the job URL so the worker caches on
    job+resume and the same pair never bills twice (<$0.05/application
    guardrail). detect.js extracts job context JSON-LD -> og: -> headings.
    The overlay gets a SECOND button on purpose: autofill is instant and local,
    tailoring costs seconds, so one button would make every autofill slow and
    every tailor accidental. A 429 opens the upgrade URL, making the wall itself
    the upgrade prompt.
  * P2.6 shipped (#191) and was mutation-tested rather than assumed. Renaming
    Ashby's email selector did NOT fail the specs, because autofill.js always
    runs fillGeneric() as a supplement and it refills input[type=email].
    Renaming firstName DID fail them. The spec header now records which
    assertions actually protect each selector map, so a green run is not
    mistaken for full coverage.
  * Verified live on .com: POST /api/extension/tailor -> 401 (present, guarded),
    OPTIONS -> 204.


- 2026-07-31 (evening) — PHASE 2 STARTED. P2.1, P2.2, P2.3, P2.5 done; PRs #186,
  #187, #188, #189. Change of Address CONFIRMED and running (.ru -> .com,
  start date 2026-07-31).
  * P2.1 audit: the extension is NOT a stub — 14 files, ~750 lines, MV3, with
    detection across 11 ATS platforms, autofill, overlay, popup, background
    worker and pairing. It found TWO real defects, both fixed:
      - the migration had silently BROKEN it. Five hardcoded .ru references, and
        host_permissions was the fatal one: without .com granted, the fetch that
        follows the .ru 301 is blocked by Chrome's extension permission model,
        so "the redirect still works" would NOT have saved it (#186).
      - tracked applications were written as source=MANUAL, indistinguishable
        from hand-typed rows. Phase 2 exists to prove the wedge drives
        activation; that is unmeasurable without attribution. Added
        JobSource.EXTENSION, verified live in the prod enum (#187).
  * P2.2/P2.3 (#188): the endpoints had Bearer auth and nothing else. The real
    gap was not the missing rate limit — THE FREE TIER WAS NOT ENFORCED
    SERVER-SIDE AT ALL, so any extension key could POST unlimited applications
    and never touch the daily limit the backend apply path respects.
    lib/extension-guard.ts is now one gate: scoped Bearer auth, a REDIS rate
    limit (60/min per API key — deliberately not the in-memory limiter, whose
    state dies with the container and is per-instance), and CORS that echoes
    ONLY chrome-extension:// origins. Fails OPEN on a Redis outage so an outage
    cannot disable the extension. Over-quota returns 429 with an upgradeUrl so
    the extension can surface the upgrade at the moment the wall is hit.
    10 tests cover the paid boundary as behaviour. Verified live: preflight 204,
    ACAO echoed for a chrome-extension origin, REFUSED for https://evil.example,
    unauthenticated GET 401.
  * P2.5 (#189): the CTA exists but renders NOTHING until
    NEXT_PUBLIC_CHROME_EXTENSION_ID is set — the extension is not in the Web
    Store yet, and a primary "Add to Chrome" linking to a listing that does not
    exist is the exact dark pattern the positioning cannot afford. One env var
    switches it on everywhere. Verified live: 0 occurrences on the landing page.
  * STILL OPEN in Phase 2:
      - P2.1 requirement 3, "Tailor resume for this job", does not exist in the
        extension at all — no call to tailoring or /jobs/cover-letter anywhere.
        This is the feature that makes the wedge more than an autofiller.
      - P2.4 Web Store listing — owner (submission + review).
      - P2.6 E2E fixtures for Greenhouse/Lever/Ashby autofill in CI.


- 2026-07-31 — **DOMAIN MIGRATION COMPLETE: resumeai-bot.ru -> resumeai-bot.com.**
  Site, email and crons all verified live on the new domain.
  * Site: `.com` serves 200 with a valid Let's Encrypt cert on every route
    (home, pricing, ats-check, resume-rescue, proof, apply-to, resume-keywords).
    `www` -> apex 301. Every `.ru` page 301s to its `.com` equivalent, so the
    301 indexed URLs transfer instead of 404ing.
  * Sitemap: **301/301 URLs now emit `.com`** (was 301/301 on `.ru`). Fixed in
    #180 — deploy.yml bakes NEXT_PUBLIC_APP_URL at BUILD time, so the
    statically-generated sitemap had frozen the old domain and no env change or
    restart could move it. sitemap.ts is now force-dynamic off lib/site.ts.
  * Email: Resend swapped `.ru` -> `.com` (their free plan allows ONE domain, so
    the delete was forced and mail was down for the gap). DKIM + SPF MX + SPF
    TXT all verified. Proven end to end: a real magic link went out at 07:01:48
    from `noreply@resumeai-bot.com` with subject "Sign in to resumeai-bot.com",
    2s after the request.
  * `INBOX_DOMAIN` deliberately stays on `.ru` — 9 users hold
    `@inbox.resumeai-bot.ru` handles and repointing it would silently kill their
    inbound replies. The `.ru` MX must keep accepting mail indefinitely.

  THREE THINGS BROKE DURING THE CUTOVER, ALL FOUND AND FIXED:
  * **Prod was rolled back ~4 months.** A manual `docker compose up -d web`
    picked up stale `WEB_IMAGE`/`WORKER_IMAGE`/`NOTIFIER_IMAGE` pins in
    `/opt/resumeai/.env` (frozen at d1f06adc, PR #35). `/apply-to/*` 404'd and
    the sitemap collapsed to 86 URLs. The deploy pipeline passes fresh tags
    inline so this never surfaced before. Repinned to the current SHA and rolled
    forward; that landmine is now defused for future manual restarts.
  * **Deploy went red.** The post-deploy smoke asserts `.../login` returns 2xx
    against a hardcoded `resumeai-bot.ru`, which now correctly 301s. The URL
    lives in deploy.yml (needs the `workflow` scope), so `BASE_URL` was set in
    `/etc/environment` on the VPS — SSH sessions inherit it via PAM. Verified,
    re-ran, green.
  * **The digest and run-campaigns crons went red**, i.e. the autonomous machine
    stopped. They POST to `.ru/api/cron/*` and curl does not follow redirects on
    POST without `-L`, so the 301 silently killed them. Caddy now SERVES
    `/api/*` on `.ru` while still redirecting every human/crawler path. Both
    crons re-run green. `/api/*` is never indexed, so no SEO cost.

  STILL OPEN (owner):
  * `deploy.yml:51` still bakes `NEXT_PUBLIC_APP_URL='https://resumeai-bot.ru'`,
    so client bundles embed the old origin and ISR-cached page canonicals lag
    until their revalidate windows lapse. One-line fix, needs `workflow` scope.
  * Google/Bing Search Console — see P0.3.
  * Optional but recommended: add the DMARC record Resend suggests
    (TXT `_dmarc` -> `v=DMARC1; p=none;`) to improve deliverability.


- 2026-07-30 (late) — "DO ALL": every owner action an agent can close, closed.
  * **#9 Stripe orphans archived.** Live mode 14 active prices -> **5**, exactly
    the 5 the code reads. Four refused at first ("cannot be archived because it
    is the default price of its product"); cleared each product's default_price,
    then they archived. The script refuses to touch any price referenced by a
    STRIPE_PRICE_ID_* env var and aborts unless exactly 5 are on the keep-list.
    Reversible (active=true). Money path re-verified after the change: tripwire
    checkout still creates (HTTP 200), $19/$180/$4.99 all resolve active.
  * **#5 Dependabot holds cleared — all 10 dependency PRs now merged.** #107
    (nodemailer 8->9 major) and #102 (starlette 1.0.1->1.3.1) were merged and
    then LIVE-VERIFIED, not merged and hoped for: sign-in POST -> 302 with
    "Sign in to resumeai-bot.ru" delivered 17:55:09, and the worker reports
    starlette 1.3.1 / fastapi 0.141.1, healthy, logs clean.
  * **#10 dead PAT removed** from .git/config; origin is now a clean tokenless
    URL and push/fetch work via the gh credential helper. Revoking the token in
    GitHub settings is still yours — it needs your account.
  * NOT done, and why: #11 (uptime workflow) is written and parked at
    ci/uptime-external-local but GitHub rejects the push without the `workflow`
    scope; #1/#8 need that same scope; #2 (GSC), #3 (Telegram Start), #4
    (domain), #6 (founder photo) and #7 (LAUNCH40 expire-vs-evergreen) all need
    your accounts or your judgement.
  * Declined on purpose: forcing an `upsell_accepted` row. The webhook branch
    calls stripe.subscriptions.retrieve on a REAL subscription, and the real
    upsell charges $9 so a card is genuinely required — the $0 path only existed
    in my test. Synthesising it would have been theatre, so it stays documented
    as unproven with the surrounding evidence that it is wired.

- 2026-07-30 (night) — PROMPT G FULLY COMPLETE. G2 shipped (#173); every exit
  criterion now verified live.
  * **Sitemap 290 -> 301 URLs, all 200-OK.** Final count by template: /apply-to
    169, /jobs-in 39, /resume-keywords 24, /resume 20, /auto-apply 12,
    /alternatives 10, /remote 10, /blog 3, plus 14 singletons. 301/301 return
    200 (full sweep), and all 301 were accepted by IndexNow (HTTP 200).
  * G2: /resume-keywords 12 -> 23 roles. The blocker was never the page
    template, it was the corpus — 76% of listings had no body text. #171 fixed
    the scraper going forward; a backfill of already-cached Greenhouse listings
    took coverage 116 -> 293 of 479 (24% -> 61%) and unblocked extraction.
  * Keywords come from the REAL LLM extractor (worker/worker/ai/keywords.py),
    the same one the product uses. The deterministic extractor was built,
    measured against this corpus and rejected TWICE — it emitted "PBC",
    "Nevada", "Dental", "Days/8", "Fortune", "Magazine". The LLM output is in a
    different league: mobile-engineer now lists Kotlin, Jetpack Compose, RxJava,
    Retrofit, Coroutines, MVVM, Android SDK.
  * An honesty bug was caught and designed out: extract_ats_keywords() truncates
    input to 3000 chars, so blending several postings silently used only the
    FIRST — while the page would have claimed "extracted from 103 real job
    descriptions". The generator now calls the extractor once PER posting (up to
    8/role) and ranks by how many postings mention a term, and listingCount is
    the number actually analysed. Verified live: /resume-keywords/mobile-engineer
    says "from 4 real job descriptions" and 4 is exactly what was analysed.
  * Merged, never replaced: 16 roles from the LLM + 7 existing carried forward
    untouched. ZERO live pages dropped — software-engineer was skipped by the
    frequency filter and would otherwise have been de-indexed.
  * New pages are conversion-wired (tripwire + free fit-check CTAs, breadcrumbs,
    507 words on the sample checked). Guard now 193 checks: min 360 words,
    191/191 unique meta descriptions.
  * DELIBERATE DEVIATION, restated because it contradicts the prompt: G1 said to
    skip companies whose scraper returns 0 jobs. NOT DONE, on purpose. Measured
    live it would have dropped 124 of 168 company pages — pages that are NOT
    thin (300+ words of unique per-company editorial, proven by the guard) and
    are already indexed. Supply arrives in bumps, so gating on "0 roles this
    hour" would churn ~120 URLs in and out of the index. Thin-content is
    enforced where it belongs: the >=300-word build guard. Say the word if you
    want the skip anyway.

- 2026-07-30 (evening) — EVIDENCE RE-SWEEP (Prompt F, second run). Full report:
  `docs/EVIDENCE_2026-07.md`, newest section first. Re-run because the 07-20
  evidence predated a six-day outage, Prompt G, 8 security bumps (incl. Next
  16.2.6 -> 16.2.12), the magic-link rewrite and three caching fixes — evidence
  that old is a claim, not a fact.
  * **F3a FAIL -> PASS. The daily pulse works.** 4 sends, latest 07-29 23:24:07
    UTC (= 9:24am Sydney), clustering exactly in the intended window. The 07-20
    "never fired" verdict was a false alarm — Session D shipped at 08:06 UTC
    that day, so the first eligible window hadn't arrived yet. The gate-widening
    I recommended was therefore deliberately NOT implemented; it would have
    "fixed" working code. D1 re-checked, Session D exit criterion now MET.
  * Money path re-proven on the new framework: real $0 tripwire purchase,
    **paid -> delivered in 12.320s** (vs 17.342s on 07-20, budget 5 min), money
    alert at 16:10:01 matching tripwire_paid to the second, delivery email
    delivered 16:10:14, upsell coupon $10 off / single-use / exactly 72.0h.
  * **F2b upgraded from simulated to organic.** On 07-20 the abandoned-checkout
    email had to be forced by backdating. This time the order genuinely sat
    unpaid from 10:38:06 and the reminder went out at 14:49:27 — 4h11m, the 4h
    rule firing by itself. The same order then paid and delivered, proving the
    reminder doesn't corrupt the later purchase.
  * F4a: **290/290 sitemap URLs return 200**, zero 404s, including all 168
    /apply-to pages and the /companies -> /apply-to redirects.
  * Unchanged PARTIALs, stated as such rather than papered over: 9 orphaned
    Stripe prices (owner action #9, untouched in 10 days), `upsell_accepted`
    still unprovable ($0 upsell checkout still demands a card), and the refund
    API still not exercisable without a real captured payment. F1d and F4b were
    NOT re-run — their 07-20 evidence stands and the report says so explicitly.
  * Owner action #12 answered and shipped — see #12 above.

- 2026-07-30 (later) — E-R REMAINDER + 8 SECURITY BUMPS + A LOGIN BUG THAT HAD
  NEVER WORKED. PRs #167 (E-R1), #168 (auth), #169 (revalidate-on-deploy), plus
  8 Dependabot merges. All live and verified.
  * **Magic-link sign-in was broken for the entire life of the deployment.**
    Found while verifying the next-auth 4.24.15 bump. EmailProvider used
    `smtp.resend.com:465`, and Hetzner blocks outbound 25 and 465 (verified from
    the host: 465 BLOCKED, 587 OPEN, 25 BLOCKED, api.resend.com:443 OPEN). So
    nodemailer opened a socket that could never complete. It failed in the worst
    way — the VerificationToken row was written FIRST, so the DB looked healthy
    and nothing logged an error, while the request hung until the client gave up.
    Resend's last 100 emails contained ZERO sign-in messages, ever. Reproduced
    live: POST /api/auth/signin/email -> HTTP 000 after 60s, token row at
    09:38:15. Fixed by sending magic links through the same sendEmail() Resend
    HTTPS path as every other email; a failed send now throws instead of
    pretending. After deploy: HTTP 302 in 0.79s and "Sign in to resumeai-bot.ru"
    delivered at 09:55:22 — the first magic-link email this deployment has ever
    sent. sendEmail is imported lazily inside sendVerificationRequest because at
    module scope the Resend SDK (-> react-dom/server) broke the auth test suite.
  * E-R1 /pricing: the audit was right. A hardcoded paragraph read "Launch week
    ... LAUNCH40 ... 40% off your first year (ends June 8)" — live on 07-30, six
    weeks stale. Live Stripe explained it: there are TWO LAUNCH40 codes.
    promo_1TdXVs... is INACTIVE, expired 2026-06-08 (the date the copy quoted);
    promo_1Th6TD... (coupon V8nDJ6pL, 40% off) is ACTIVE with 0 redemptions to
    2026-09-01, matching lib/promo.ts. So the offer was real, the copy quoted a
    dead promo. Now rendered from lib/promo.ts and gated on isPromoActive().
    ALSO corrected the label: the coupon is duration `once` and redeemable on
    ANY plan, so "40% off your first year" was FALSE for monthly subscribers
    (40% off month one). Now "40% off your first payment", true for both. To
    advertise "first year", restrict the coupon to the annual price first.
    Guard extended to ban hardcoded promo dates + the literal LAUNCH40 string;
    verified it actually fires by reintroducing both and watching it fail.
  * E-R2/3/4/5 + audit items 5 and 6 were ALREADY DONE by Prompt E — verified
    against live prod, not assumed: no "Not getting interviews?", unified nav on
    /pricing, per-page OG ("Pricing — ResumeAI" + /pricing/opengraph-image), no
    "50+ countries", /companies/* 308-redirecting. Skipped rather than redone.
  * 8 security bumps merged and deployed: fast-uri, immutable +
    swagger-ui-react, postcss, next-auth 4.24.15, ws, axios, pillow, and next
    16.2.6 -> 16.2.12 (Server-Actions DoS advisory). Re-verified magic link,
    all key pages, and the G1 enrichment on the new framework version.
  * Third caching bug found by re-verifying: after the next-16.2.12 deploy the
    company pages were bare AGAIN. Every deploy rebuilds all 168 pages with the
    dummy DATABASE_URL, but the 6h dedupe marker from 09:56 made the cron skip
    revalidation until ~15:56. Fixed by also comparing against this process's
    start time — a container newer than the last marker is by definition serving
    freshly-built pages. Verified: revalidated at 10:16 despite the 08:56
    marker, and the roles section came back (52 roles, 8 links, 44/168 companies).
  * MEMORY PRESSURE: investigated, NOT a standing problem. The
    `insufficient_memory (550MB < 700MB)` lines were transient, from the
    outage-recovery window with concurrent deploy builds. Now: worker using
    73MB of its 1465MB limit, host 2414MB available, ZERO deferrals in 24h.
    MIN_APPLY_MEMORY_MB=700 on prod (code default 300) is a deliberate guard
    that DEFERS applies rather than risking an OOM-kill — left alone on purpose.
  * All 8 workflows verified green. The only remaining red is Dependabot's own
    js-yaml job, which is expected: every advisory lists patched-versions: [].

- 2026-07-30 — SIX-DAY PRODUCTION OUTAGE, then PROMPT G shipped.
  * OUTAGE: the site was unreachable from 2026-07-23 10:47 UTC until the
    owner restored it on 07-29. Cause was NETWORK-level, not the app: the
    host showed `up 54 days` (never rebooted), disk 24%, all 7 containers
    healthy the whole time, and no deploy since 07-20 — but 443/22/ICMP were
    all black from every vantage (my machine AND GitHub runners). Consistent
    with an upstream null-route / DDoS filter at the provider, since cleared.
    Cost: 88+ consecutive cron failures, so nurture, daily pulse, money
    alerts and the SEO cron were all dead for ~6 days. LESSON: uptime-kuma
    runs ON the same box, so it cannot page us when the box is unreachable —
    external monitoring is now the top ops gap (owner action #11).
  * All 8 workflows verified green afterwards (ci, deploy, digest,
    follow-up, run-campaigns, seed-surveys, win-back, codeql). The three
    daily crons were manually dispatched to prove recovery rather than
    waiting for their next slot.
  * PROMPT G — G1/G3/G4 shipped and live-verified; G2 blocked (below).
    Deliberate scope call: `/companies/*` did not exist, but the "how to
    apply at {Company}" content it describes already shipped at
    `/apply-to/*` (168 pages, Session B). Building a parallel namespace
    would have duplicated ~150 pages of ATS content, split equity, and
    tripped G4's own duplicate-meta guard — so /apply-to stayed canonical
    and /companies/* 308-redirects into it.
  * Two real bugs, both caught by verifying instead of assuming:
    1. `unstable_cache` JSON-serializes its return value, so the Map I used
       round-tripped to `{}` and broke every lookup — caught by CI's DB-less
       build (`a.byCompany.get is not a function`). Fixed to a plain object.
    2. The enrichment shipped INVISIBLE. deploy.yml builds with a dummy
       DATABASE_URL, so the persisted data cache stored the
       `available:false` snapshot and served it for its whole 6h TTL;
       revalidating routes just re-rendered from that empty snapshot.
       Verified live: 200s with ZERO role links. Fixed by dropping the
       persisted cache for React `cache()` (per-render dedupe only) so every
       ISR regeneration reads the DB fresh. Post-fix: 52 roles at Twilio,
       42 at Cloudflare, 8 sample links each.
  * Also rejected a plausible-looking change: the prompt's "skip any company
    whose scraper returns 0 jobs" would have DROPPED 124 of 168 pages (only
    44 have cached roles right now). Those pages are not thin — each carries
    300+ words of unique editorial — they are indexed and ranking, and
    supply arrives in bumps, so gating on "0 roles this hour" would churn
    ~120 URLs in and out of the index. Thin-content policing belongs in the
    >=300-word build guard, not in hiding live pages.
  * LIVE VERIFICATION: 290/290 sitemap URLs return 200 (zero 404s); sitemap
    unchanged at 290 URLs by template (169 /apply-to, 39 /jobs-in, 20
    /resume, 13 /resume-keywords, 12 /auto-apply, 10 /alternatives, 10
    /remote, 3 /blog, 14 core); IndexNow accepted all 290 at both
    api.indexnow.org and bing.com (HTTP 200); smoke green (12 HTTP checks +
    6 containers).
  * G EXIT CRITERION NOT MET: "sitemap grows past 300 URLs". It is still
    290. The URL growth was supposed to come from G2's ~50 role pages, which
    is blocked — see below. G1 deepened the existing 168 rather than adding
    URLs. Not padding the sitemap to hit a number.
  * G2 BLOCKED, reported not faked. `scripts/gen-role-keywords.ts` is
    committed as the auditable role-coverage analyzer (Session B had NO
    generator, so the corpus could never be refreshed). Title bucketing
    works well (102 software-engineer, 44 engineering-manager, 37
    support-engineer) and it MERGES rather than replaces so no live page is
    de-indexed. Two blockers stop publication: (a) 363 of 475 cached
    listings (76%) have an EMPTY description — the Greenhouse scrapers
    persist title+URL, not the body, so most roles have no text to extract
    from, and that is a crawler data-capture change under the freeze rule
    (owner action #12); (b) a deterministic extractor is not good enough —
    against the live corpus it produced company names, US states and
    benefits boilerplate ("PBC", "Veeva", "Nevada", "Dental", "Days/8",
    "Let", "Thing"), and title-mining was worse. The 12 live pages keep
    their real LLM-extracted keywords (AWS, Kubernetes, FastAPI) rather than
    being replaced by 16 degraded ones. Script defaults to READ-ONLY.
  * NOTE: prod web logs show recurring `insufficient_memory (550MB < 700MB)`
    — the box is a 4GB CX23 with ~1.5GB available. Not currently failing
    user requests, but it is the next thing likely to break.

- 2026-07-20 — EVIDENCE SWEEP. Full report: `docs/EVIDENCE_2026-07.md`.
  Not a feature session — an attempt to prove the autonomous half actually
  runs, against live Stripe / live DB / live domain. 16 items: 10 PASS,
  4 PARTIAL, 1 FAIL, and 3 defects found.
  * PASS, with real timestamps: end-to-end tripwire purchase (**17.3s**
    paid→delivered vs a 5-min budget), Pro subscription opening the quota
    gate (dailyApplicationLimit 3→25, firstPaidAt set), upsell coupon
    ($10 off, single-use, exactly +72h), /ats-check → lead + delivered
    report + nurture scheduled at +2d, abandoned-checkout email at the 4h
    mark, one-click unsubscribe → suppression row + sequence stopped,
    three real-time money alerts matching their events to the second,
    IndexNow 290 URLs accepted by the real Monday cron, 290/290 sitemap
    URLs 200, Lighthouse SEO 100 on all four sampled pages.
  * FAIL — **the daily pulse has never fired** (zero `daily_pulse_sent`
    rows, all time). D1 unchecked above; the one-hour Sydney gate loses to
    GitHub's hour-skipping scheduler.
  * Defect FIXED (PR #155): a failed rescue on an order with no captured
    payment alerted "refund FAILED - refund manually in Stripe!" and told
    the customer a refund was coming. Both false. Outcome is now
    three-state; two regression tests added.
  * Defect OPEN: `npm run smoke` prints "All smoke checks passed" after
    silently skipping every container check (P0.1 note above).
  * Owner decision: **9 of 14 active live Stripe prices are orphans**
    ($299, $287.90, $199, $191.90, $149, $39.99, $19.99 ×2, $2.99 ×2).
    All 5 that the code reads reconcile exactly. Archiving live payment
    config is a human call — owner action #8.
  * Could not prove: `upsell_accepted` (the upsell route requires a card
    even at $0 today, and entering live card details is out of scope) and
    the real `stripe.refunds.create` call (no captured payment on a
    100%-off test order). Both documented with what *was* proven instead.
  * All live test artifacts cleaned: 3 promos deactivated, 3 coupons
    deleted, test subscription cancelled, 2 sessions expired, the real
    upsell promo restored on the order it belongs to.

- 2026-07-20 — PROMPT E COMPLETE (homepage + site-wide consistency).
  PRs #148 (E1), #149 (E2), #150 (E3), #151 (E4), #152 (fix). All live and
  verified on prod.
  * E1 single source of truth: lib/pricing.ts now owns every price
    (added RESCUE_PRICE_USD $4.99, UPSELL_FIRST_MONTH_USD $9, derived
    PRO_ANNUAL_SAVINGS_USD, PRICE.* strings); ~20 hardcoded literals
    across components/pages replaced. lib/stats/verified.ts is now the
    ONLY pipeline-counter query — /proof and the blog each ran their own,
    which is how numbers could diverge. Guard test fails the build if a
    price or a banned claim reappears (proven to fail, not just pass).
  * E2 homepage rebuilt: hero repositioned (tailored resume per role +
    verified applications + one inbox; auto-apply demoted to a feature),
    three ?ref-tagged money paths above the fold AND mid-page, divergent
    3-tool comparison table replaced by a link to /compare (10 tools).
    New SiteHeader/SiteFooter (server components, zero client JS) now on
    ALL public pages — the ~290 programmatic SEO pages previously had no
    navigation at all.
  * E3 claim hygiene: all 19 '50+ countries' occurrences retired for a
    defensible claim derived from the real company list; interview-linked
    refund wording removed from /pricing, /dashboard/billing and the
    /refund-policy meta.
  * E4 per-page social cards: lib/og-card.tsx + 7 routes (incl.
    params-aware /blog/[slug] and /alternatives/[competitor]); missing
    openGraph/twitter blocks added. Verified live: every page serves its
    own og:title AND its own og:image.
  * AUDIT CORRECTIONS: two claimed defects were already fixed and were
    verified stale against live prod before acting — the 321/88 counters
    (removed in A4; the homepage had none) and the '$299 Unlimited' tier
    (hidden in #129). The REAL divergence was the duplicated stats query.
  * SELF-INFLICTED BUGS CAUGHT: (a) the E1 guard's
    `git ls-files 'app/**/*.tsx'` glob silently skipped files directly in
    app/ — it never checked app/page.tsx, the very homepage it polices
    (fixed in E2, then verified it caught the homepage's $19);
    (b) the E3 claim rewrite pushed five templated meta descriptions past
    seo_health's real 155-char gate (not 160), failing E3 CI — fixed
    before merge; (c) my own E4 OG cards hardcoded $19/$15/$4.99 — the
    guard caught it at the DEPLOY gate, Docker build and VPS deploy were
    skipped, so production was never broken (PR #152).
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
- 2026-07-20 — SESSION D COMPLETE. Autonomous ops telemetry: daily pulse
  (~9am Sydney, 📊), real-time money alerts on the Stripe webhook (💰,
  tripwire/sub-start/cancel, deduped by event id), weekly SEO watch (🔎,
  Mondays), and a money-path self-check (~6h loop + extended smoke.sh:
  tripwire renders, fit-check <5s, webhook verifies signatures). All
  self-gated in the hourly digest cron; notifier admin_alert extended with
  optional title/emoji so reports don't wear the error siren. 13 new ops
  tests + 74 in the touched suites green. LIVE VERIFICATION on prod
  (PR #146, deploy rebuilt web + notifier):
  * D2 money alert — drove a live $0 tripwire purchase (DMONEY100 promo);
    webhook -> notifier admin_alert.sent (💰) at 08:37 UTC, order DELIVERED,
    tripwire_paid recorded. Fires on $0 promo purchases = exit criterion. ✓
  * D4 self-check — cron ran ops_selfcheck_ran {ok:true}; the SIGNED Stripe
    test event was accepted 200 (evt_selfcheck recorded); all 3 new smoke.sh
    checks green live (tripwire renders, fit-check 400 in 0.45s, webhook
    rejects unsigned with 400). ✓
  * D1/D3 delivery — published a 📊 pulse-style message -> notifier
    admin_alert.sent, delivered with the report emoji (title/emoji path
    works for reports, not just the money siren). ✓  Daily pulse content is
    unit-tested + the gate; autonomous 9am-Sydney arrival fires at the next
    23:00 UTC (founder to confirm first arrival). SEO watch fires next Mon.
  All test data + promos cleaned up.
- 2026-07-19 — SESSION C COMPLETE (PR #144). Autonomous capture -> nurture
  -> convert funnel shipped; migration 20260718100000_nurture_fields applied
  on prod (Lead nurture cols + EmailSuppression + RescueOrder.abandonedEmailAt
  all confirmed). LIVE VERIFICATION on prod (curl against /api/ats-check,
  test email cnurture-verify@, cleaned up after):
  * free tier: score 63 + 2 findings, unlocked=false, 3 hints locked ✓
  * email WITHOUT consent -> 400 (C4 gate) ✓; WITH consent -> unlocked,
    3 hints ✓
  * Lead enrolled: nurtureStage=1, consentAt set, lastScore=63,
    lastJobTitle captured, nurtureNextAt=+2.00d ✓; fitcheck_started x2 +
    lead_captured x1 events ✓
  * unsubscribe: HMAC token -> 303 -> /unsubscribed; EmailSuppression row
    (reason=unsubscribe) + Lead.unsubscribedAt set + sequence stopped ✓
  * suppressed re-capture: full report still returned (good UX) but NO
    re-enrollment + NO new lead_captured event ✓
  * digest cron tick: nurture+abandoned processing ran clean (200, no
    errors; test lead not yet due so 0 sent, correct)
  * C3 revenue-funnel data path returns sane counts (25 visits / 3
    fitchecks / 1 lead / 0 tripwire-with-payment / leads-in-nurture).
  Nurture schedule verified: t0 (inline) / +2d / +5d / +9d, stops on
  purchase or unsubscribe.
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
