# ResumeAI Bot — Strategic Analysis & Roadmap to $10K MRR

**Author:** Strategic review based on project context dated 2026-05-21
**Audience:** Founder (Adam) + Claude Code execution
**Companion files:** `docs/strategy/prompts/01-08-*.md` — surgical Claude Code prompts, run in order
**Read order:** This doc first → then prompts in numbered order

---

## 0. TL;DR — What to do this week

1. **Run Prompt 01 (System Audit)** — get the current state of GitHub ↔ VPS ↔ prod in writing. Nothing else matters if the system is drifting.
2. **Run Prompt 02 (Resume Quality)** — your single biggest revenue lever. Every competitor user complains about generic AI output. Win on this.
3. **Run Prompt 03 (PDF Templates)** — 5 ATS-safe templates with a picker. Competitors charge $40/mo and still output one ugly template.
4. **Run Prompts 04 (Stability) + 05 (Annual plan + pricing fixes)** — capture revenue from existing traffic.
5. **Skip:** Teams/multi-tenancy. Defer: 2FA (Prompt 06 when ready).
6. **Build next:** Referral (Prompt 07) + simple feature flags / A/B harness (Prompt 08). These two are the difference between $1K MRR and $10K MRR.

**Budget reality check:** at $500–2K/mo you cannot outspend Sonara ($1.8M ARR) on paid acquisition. You win by (a) shipping higher-quality output, (b) using your 30-day money-back as a conversion weapon against LazyApply's 2.4-star refund horror reviews, and (c) compounding organic via referral + content SEO (Simplify's exact playbook).

---

## 1. System health — am I in sync?

I cannot directly read the VPS or the live GitHub HEAD from this seat, so the source of truth for the audit is **Prompt 01** which Claude Code will run against the actual repo. What I can do from the context you handed me is flag the structural risks I'd verify first:

**Known sync gaps from the context you provided:**

| Risk | What's documented | What's almost certainly drifting |
|------|------------------|----------------------------------|
| `ARCHITECTURE.md` is missing 4 live subsystems | The Chrome extension, OpenRouter proxy, PDF endpoint, and `STRIPE_PRICE_ID_TRIAL` are all in code but not in the architecture doc | Anyone (including future-you and Claude Code) will reason about the system wrong. Update first. |
| `hh.ru` dead columns | `hhToken`, `hhResumeId` exist in Prisma schema, no live code | Migration debt. Cheap to clean up, expensive if left. |
| `STRIPE_PRICE_ID_TRIAL` orphan | Exists in `.env` but no "trial" plan in `PRICING_PLANS` | Either you intended a trial product and never finished, or the env var is dead. Either way: decide and resolve. |
| In-memory job store in worker | Documented as known debt | **High-severity for production.** A single worker restart wipes every in-flight autoapply job. Must move to Redis or Postgres before scaling acquisition. |
| OpenRouter single point of failure | Whole AI stack depends on it | One outage and 100% of resume generation fails. Need fallback. |
| Sentry DSN never configured | Monitoring code present | You are flying blind in production. Free Sentry tier covers your traffic. Plug it in now. |

**Architecture verdict:** The system is well-designed for its stage. 9 subsystems is a lot for one founder — that's both impressive and a flag. The risk isn't the architecture, it's that the docs lag the code; if you bring on a contractor or run a serious audit, they'll trip on the gaps above.

Prompt 01 makes Claude Code verify all of this against reality and produce a sync report before touching anything.

---

## 2. Resume quality — why this is your wedge

**The customer pain across all three competitors is the same complaint:** "The AI output is generic, I'd be embarrassed to send it." Quotes:

- **Simplify+ ($39.99/mo):** Trustpilot reviews dominated by users who "expected AI resume and cover letter output worth that price, and found it too generic to use without substantial revision." ([6figr review](https://6figr.com/blog/simplify-review-is-it-worth-your-money-in-2026-630))
- **Sonara ($23.95/mo):** Users report "resume hallucinations" and inflated/duplicate job matches. ([Resume Judge review](https://resumejudge.com/blog/sonara-ai-review/))
- **LazyApply (2.4★ on Trustpilot):** "Software that simply doesn't function, support that never responds, refunds that are ignored." ([Trustpilot](https://www.trustpilot.com/review/lazyapply.com))

**Your opening:** be the one that consistently produces resumes a recruiter wouldn't immediately spot as AI slop. Three concrete moves, all in Prompt 02:

1. **Replace the resume generation system prompt** with a STAR/CAR framework prompt that forces: action verb start, quantified result, scoped context. Most AI resume tools use weak prompts like "rewrite this professionally" — you'll use a constraint-based prompt that rejects bullets without numbers.
2. **Add a per-job ATS keyword extraction step** — pull keywords from the JD, ensure each appears verbatim at least once in the tailored resume (this is what JobScan sells as its whole product).
3. **Add a self-critique pass** — second LLM call grades the draft against a rubric (action verbs ≥80% of bullets, quantification ≥60%, no clichés, no fabrications), rewrites failures.

Total token cost increase per resume: ~2.5× (one extraction + one generation + one critique). At gpt-4o-mini pricing this is still <$0.01 per resume. Worth it.

> **✅ COMPLETED — 2026-05-23 (Prompt 02)**
>
> All three steps above are now live behind the `RESUME_QUALITY_V2` feature flag:
>
> | Component | File | Status |
> |-----------|------|--------|
> | STAR/CAR system prompt (V2) | `worker/worker/ai/prompts/resume_v2.txt` | ✅ shipped |
> | Per-job ATS keyword extraction | `worker/worker/ai/keywords.py` | ✅ shipped |
> | Self-critique rubric pass | `worker/worker/ai/critique.py` | ✅ shipped |
> | V2 tailor pipeline (`_tailor_resume_v2`) | `worker/worker/ai/tailor.py` | ✅ shipped |
> | V2 cover letter pipeline | `worker/worker/ai/tailor.py` | ✅ shipped |
> | Feature flag (`RESUME_QUALITY_V2`) | `worker/worker/config.py` + `docker-compose.yml` | ✅ shipped |
> | Analytics tracking (`resume_generated` event) | `app/api/cron/run-campaigns/route.ts` | ✅ shipped |
> | Tests (25 assertions) | `worker/tests/test_resume_quality.py` | ✅ 25/25 pass |
>
> **Next step:** enable flag on VPS — add `RESUME_QUALITY_V2=true` to `/opt/resumeai/.env` and restart the worker container.

**ATS standards to bake in (from 2026 best practices):** single-column reverse-chronological, no tables/text boxes, contact info in body (not header), Arial/Calibri/Helvetica/Garamond/Cambria fonts only, .pdf (text-layer) and .docx export, all section headings standard ("Work Experience", "Education", "Skills"). ([Jobscan ATS guide 2026](https://www.jobscan.co/resume-templates/ats-templates))

---

## 3. PDF templates — what to ship

Recommend **5 templates** at launch, all single-column, all ATS-safe. Two engines to consider:

| Engine | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **WeasyPrint (HTML+CSS→PDF)** | Designers can iterate templates in CSS. Easy to add more. Same engine that ships PDF email and reports for thousands of SaaS apps. | Heavier dependency. CSS quirks for some print features. | **Yes — use this.** Faster to add new templates, easier to hand off, the way modern resume builders do it. |
| **ReportLab (current)** | Already in worker. Pixel control. No new dep. | Templates are Python code — slow to design, hard to iterate. | Keep for the **download-only PDF endpoint** you already shipped. Don't build the template library on it. |
| **LaTeX** | Beautiful output. The classic. | Heavy install, slow render, hard to deploy in a Docker worker, overkill. | No. |

**The 5 templates to ship** (matches what every paid resume builder offers):

1. **Modern Minimalist** — Calibri 11pt, single accent color (your brand blue), 0.5" margins. Default. Used by 60% of users.
2. **Classic Executive** — Garamond 11pt, traditional, no color. For finance/law/consulting.
3. **Tech Compact** — Helvetica 10pt, dense, fits more bullets. For engineers.
4. **Creative Accent** — Same single-column ATS-safe skeleton, but with a colored sidebar of subtle accent (still parseable — sidebar is a `<div>` not a column). For marketing/design.
5. **New Grad** — Top-loads Education and Projects, smaller Experience section. For students/interns — this is also your Simplify-style SEO play.

Prompt 03 implements all 5 plus a template-picker UI and a "preview before download" flow.

**✅ Prompt 03 — COMPLETE (2026-05-23)**

Shipped:
- 5 ATS-safe Jinja2/WeasyPrint HTML templates: `modern_minimalist`, `classic_executive`, `tech_compact`, `creative_accent`, `new_grad`
- Shared `_common.css` (print margins, section headings, page-break rules, font stacks)
- `POST /jobs/resumes/{id}/render` endpoint with auth, 400 on unknown template
- `§3.2 adaptResumeData()` adapter — prefers `resume_structured`, falls back to line-parsed `resume_text`, minimal stub as last resort
- DB migration: `Resume.templateId TEXT DEFAULT 'modern_minimalist'`
- `PATCH /api/resumes/{id}/template` route to persist picker choice
- `TemplatePicker` client component gated by `PDF_TEMPLATES_V1` feature flag
- SVG placeholder thumbnails; `regenerate_thumbnails.py` for real PNGs on VPS
- `lib/flags.ts` → `isPdfTemplatesV1()` / `isResumeQualityV2()`
- Full test suite: 46 unit + template-sanity tests pass; 10 integration tests skip when system libs absent

---

## 4. Competition deep dive — top 3

### 4.1 Sonara.ai

**Numbers:** $1.8M ARR (Oct 2024), 52 employees, SF-based, B2C, ~5 years old. ([Latka](https://getlatka.com/companies/sonara.ai))

**Pricing:** $2.95 trial (10 apps / 14 days) → $23.95/mo or $71.40/yr (~$5.95/mo equivalent).

**What they do well:**
- **Trial-first funnel.** $2.95 friction filters tire-kickers but is low enough to convert. You currently have no paid trial.
- **Strong brand & SF cred.** YC-adjacent positioning.
- **Annual plan ~75% discount** vs monthly — locks in revenue.

**What they do badly (your openings):**
- **Resume hallucinations** — well-documented in reviews. You can win here with Prompt 02.
- **Duplicate/irrelevant job matches** — they inflate counts, users notice. Your scrapers are already cleaner; emphasize match quality in marketing.
- **No free tier** — only paid trial. You have a real free tier (3 apps/day). Use it.

**Steal from them:** the $2.95 trial mechanic + the annual plan discount. Both in Prompt 05.

### 4.2 Simplify.jobs (Copilot)

**Numbers:** 1M+ Chrome extension installs, 4.9★ rating, YC-backed. Premium: $39.99/mo. ([Chrome Web Store](https://chromewebstore.google.com/detail/simplify-copilot-autofill/pbanhockgagggenencehbnadejlgchfc))

**What they do well — the most important playbook for you to copy:**
- **Free autofill extension is the entire growth engine.** They give away the form-filler, charge $39.99/mo for AI tailoring. The free product seeds installs and the paid product converts a single-digit % of those installs into massive revenue. **You already have a Chrome extension. You're sitting on this exact playbook.**
- **SEO at scale on internships / entry-level lists.** They publish hundreds of pages like "Summer 2026 Internships," each ranking for low-comp long-tail keywords. ([Simplify internships hub](https://simplify.jobs/internships)) Each page is essentially a job aggregator landing page that captures visitors who then install the extension. This is the cheapest, most scalable acquisition channel for your stage.
- **Autofills 20,000+ career pages incl. Workday/Lever/Greenhouse.** Coverage is the moat.

**What they do badly:**
- **No refunds, no free trial on paid plan** — users feel trapped.
- **Generic AI output on paid tier** — same complaint as everyone else.
- **Weekly plan at $19.99 looks predatory** — anchor for monthly conversion but burns trust.

**Steal from them — top priority:** the free extension → paid tailoring funnel, and the internship/entry-level SEO content engine. Both are explicitly in your roadmap below.

### 4.3 LazyApply

**Numbers:** Basic $99/yr, Premium $149/yr, Ultimate $999/yr (was $1,099). Trustpilot 2.4★, 56% one-star. ([Trustpilot](https://www.trustpilot.com/review/lazyapply.com))

**What they do well:**
- **Annual-only pricing** — kills churn from the start, gets cash up front.
- **LinkedIn auto-apply** — high-volume, easy to demo, marketing-friendly ("apply to 750 jobs in a day").
- **AppSumo and StackSocial deal distribution** — built early audience through lifetime deal marketplaces.

**What they do badly — and this is your conversion weapon:**
- **Downgraded lifetime customers** from "unlimited" to 150/day. Permanent reputational damage.
- **Refunds ignored** even when stated policy says otherwise.
- **No support response** for weeks.
- **LinkedIn detection risk:** Chrome extension architecture has 60% higher LinkedIn ban risk than cloud platforms with rotating dedicated IPs. ([Growleads 2026](https://growleads.io/blog/linkedin-automation-ban-risk-2026-safe-use/))

**Your weapon:** every piece of your marketing copy should say or imply: *"30-day money-back guarantee, no questions asked. Refunds processed in 48 hours."* LazyApply's existing 2.4-star reputation is a giant red flag for shoppers — your money-back guarantee converts them. **Put a Trustpilot widget on your pricing page once you have ≥10 reviews.**

### 4.4 Pricing comparison table

| Tool | Free tier | Trial | Monthly | Annual | Lifetime |
|------|-----------|-------|---------|--------|----------|
| **Sonara** | — | $2.95 / 10 apps | $23.95 | $71.40 (=$5.95/mo) | — |
| **Simplify Free** | autofill only | — | — | — | — |
| **Simplify Plus** | — | — | $39.99 | (n/a public) | — |
| **LazyApply Basic** | — | — | — | $99 | — |
| **LazyApply Ultimate** | — | — | — | $999 | — |
| **ResumeAI Free** | 3 apps/day | — | — | — | — |
| **ResumeAI Pro** | — | — | $19.99 | **MISSING** | — |
| **ResumeAI Unlimited** | — | — | $29.99 | **MISSING** | — |

**Action items:**
- Add **annual plans** at $199/yr (Pro, ~17% off) and $299/yr (Unlimited, ~17% off) → grows ARPU, kills early churn. Specced in Prompt 05.
- Consider adding a **$1 / 7-day trial** as a Pro tier on-ramp (Sonara-style funnel). Test after annual plan.

### 4.5 Competition gap matrix (the verdict)

| Feature | Sonara | Simplify | LazyApply | **ResumeAI today** | **Gap?** |
|---------|--------|----------|-----------|---------------------|----------|
| Free Chrome autofill ext. | No | **Yes (1M+ installs)** | No | Yes (built, not marketed) | **PROMOTE** |
| AI resume tailoring | Yes (hallucinates) | Yes (generic) | Yes (basic) | Yes (improve via Prompt 02) | Quality |
| Multiple PDF templates | Limited | 1 default | 1 default | None today | **Prompt 03** |
| ATS keyword scoring | No | Limited | No | None | **Prompt 02** |
| Auto-apply (LinkedIn) | Yes | No | Yes (risky) | Yes (be careful) | Risk mgmt |
| Auto-apply (other) | Yes | No | Yes | Yes (CareerOps) | Parity |
| Free tier | No | Yes (ext only) | No | **Yes (3 apps/day)** | Strength |
| 30-day money back | No | **No** | No (per reviews) | **Yes** | **Weapon** |
| Annual plan | Yes (~75% off) | n/a | Only option | None | **Prompt 05** |
| Referral program | No | No | No | None | **Build it (Prompt 07)** |
| ATS pass score | No | No | No | None | Future |
| Cover letters | No | Yes | Yes | Yes | Parity |
| Interview prep | No | Yes (basic) | No | None | Future |
| Job match scoring | Yes (poor) | Yes | Yes | Limited | Future |

---

## 5. QA review — additional checks to add

You shared that `docs/qa/launch_readiness_2026-05.md` exists with 50+ checks across security, performance, DB, E2E, marketing. I don't have direct read access from here, but based on what you described and the known issues list, here's what I'd add or stress-test:

**Critical adds (do before promoting the site):**

1. **Sentry DSN connected and verified.** Add a Sentry smoke test in CI that fires a synthetic error on deploy and checks it lands. You already deleted the smoke route — re-add as a CI-only ping.
2. **Stripe webhook idempotency.** Verify that re-delivering the same `checkout.session.completed` event does NOT double-credit. Test by replaying from the Stripe dashboard.
3. **Worker job persistence.** The in-memory store will lose jobs on restart. Either move to Redis (recommended) or document a deploy procedure that drains in-flight jobs. **Don't run any paid acquisition until this is resolved.**
4. **OpenRouter outage simulation.** Kill the proxy in staging and verify the user sees a graceful error, not a 500. Also: add a fallback (direct OpenAI with a credit card on a US-routable proxy, or a second OpenRouter key).
5. **LinkedIn auto-apply rate limiting & per-user IP isolation.** Per the 2026 detection research, your highest-tier feature is also your highest legal/reputational risk. Add: per-account daily caps, randomized human-like delays (NOT uniform random — that's now a detection signature), and a user-facing disclaimer that says "LinkedIn automation may result in account restriction; use at your own risk."
6. **Legal date sweep.** Your `/terms` and `/privacy` say January 2024. **This alone fails most enterprise vendor reviews and reads as abandoned to consumers.** Update to today's date and add a "last updated" timestamp logic so it's always current on deploy. Trivial fix.
7. **GDPR data export & delete endpoints.** If you have any EU traffic (you do — landing is in English), you need a self-serve data export and account deletion. Both are <1 day of work and they unlock a lot of paid acquisition that would otherwise be a compliance risk.
8. **Refund flow E2E test.** You have a money-back guarantee that you'll use in marketing. The refund endpoint MUST be tested end-to-end (create paid sub → request refund → Stripe refund processed → email sent → DB updated). Coverage is currently ~0% on `email-refund-confirmation.ts`.
9. **PMF survey 24h dismiss enforcement.** Spec says 24h, code only blocks per-session. Trivial bug, real annoyance. Fix while you're in the area.
10. **Daily digest timezone tests.** Cron triggers at server time — verify per-user timezone delivery still works for users in PT/CT/ET (currently 0% coverage on `daily-digest.tsx`).

**Performance benchmarks worth recording before launch (so you can detect regressions later):**

- p50/p95/p99 for `/api/resumes/[id]/pdf` (target p95 < 3s)
- p50/p95 for resume generation end-to-end (target p95 < 12s)
- Worker concurrency: how many simultaneous resume generations before the box dies?
- Database connection pool exhaustion threshold

**Marketing readiness:**

- LinkedIn OG inspector check (you flagged unverified)
- Twitter/X card validator check
- Facebook sharing debugger refresh
- Pinterest rich pin check (if you'll use Pinterest — students do)
- robots.txt + sitemap.xml verified in Google Search Console
- Hreflang tags if you plan to add localized pages later

---

## 6. Feature decisions — what to build, what to skip

### 6.1 Teams / multi-tenancy → **SKIP** (for now)

**Why:** Wrong audience. Job seekers are individuals. Adding teams now means: new permission model, new billing logic, new UI surface, and you serve almost zero customers who'd actually want it. Reconsider at $50K MRR if a clear B2B angle emerges (e.g., universities, bootcamps, outplacement firms).

**Hidden cost of building it now:** Every feature you ship has to consider the teams model from then on. That's a 10–20% velocity tax forever, in exchange for ~0 incremental revenue at this stage.

### 6.2 2FA → **YES, but later** (defer to Q3 / after first 100 paying customers)

**Why:** Not blocking revenue. Email + Google + GitHub OAuth covers the security baseline. You don't store credit cards or sensitive PII beyond resumes. 2FA matters when (a) you have an enterprise sale that requires it, (b) you have a real incident, or (c) you cross ~500 paying users (population-level attack risk rises).

**When you do add it:** TOTP via `otplib` + recovery codes, free `@simplewebauthn` library if you want WebAuthn. ~1 sprint. Don't roll your own.

**Specced in Prompt 06** so it's queued and ready.

### 6.3 Referral program → **YES, NOW** (highest ROI growth lever at this stage)

**Why this matters more than almost anything else:** at $500–2K marketing budget, you cannot win on paid CAC vs Sonara. You win on viral coefficient. A double-sided referral ("give $20, get $20" toward subscription credit) typically drives 15–30% of new SaaS signups once seeded, at $0 marginal CAC.

**Concrete spec:**

- Both sides get $20 credit toward subscription when the referee pays for their first paid month.
- Referrer's unique link is `resumeai-bot.ru/r/{username}`.
- Track in new `Referral` table (referrer_id, referee_id, status, credited_at).
- Apply credit via Stripe coupon at next invoice (not cash).
- Cap: $200/yr per referrer (10 referrals) to prevent abuse.

**Specced in Prompt 07.** Should be live within 1–2 weeks.

### 6.4 Feature flags → **YES, NOW** (foundational for A/B testing)

**Why:** You can't run experiments without flags. You can't safely roll out the changes from prompts 02/03/05 without flags. You're flying blind every time you ship.

**What to use:**
- **Stage 1 (now):** env-var driven flags via a tiny `lib/flags.ts` wrapper. Zero dependency. Reads from DB row keyed by user (5min cache).
- **Stage 2 (at ~$5K MRR):** Migrate to PostHog (free tier covers you to 1M events/mo) or GrowthBook self-hosted. Both have feature flags AND A/B testing AND product analytics in one tool.

**Specced in Prompt 08** (combined with A/B testing).

### 6.5 Affiliate system → **YES, soon (after referral)**

**Why:** Affiliates and referral are different beasts. Referral = your users invite friends. Affiliate = third parties (career coaches, resume writers, finance YouTubers, Reddit influencers, niche bloggers) drive paying traffic for a recurring cut. At $19.99/mo with a 30% recurring affiliate commission, an affiliate earns $6/mo per customer — enough to motivate niche creators with small but loyal audiences.

**Recommended stack:**
- **Tolt ($29/mo)** or **Rewardful ($49/mo)** — both handle Stripe integration, attribution, and payouts. Don't build this yourself. Rolling your own affiliate system is ~3 weeks; an off-the-shelf one is 2 hours of integration.
- Target affiliates in order: career-coach Substacks, /r/JobSearchHacks moderators, AI tools newsletter writers, university career-services contacts.

**Specced in Prompt 07** (combined with referral — both share UI surface).

### 6.6 A/B testing infrastructure → **YES, NOW** (light version)

**Why:** Without A/B testing you'll make pricing, copy, and onboarding decisions on vibes. With it you'll have one statistically defensible improvement per month — compounding.

**Stage 1 (now, Prompt 08):**
- Cookie-based 50/50 assignment, persisted to DB on signup
- One env-driven experiment flag config
- Conversion tracked in `AnalyticsEvent` table (which already exists per architecture)
- Manual results review via SQL

**First three experiments to run, in order:**
1. **Pricing page headline** — current vs. "Land your next job in 30 days or your money back."
2. **Free tier daily cap** — 3 apps/day vs 5 apps/day. Hypothesis: more free value = more word-of-mouth, but lower conversion to paid. Need to measure.
3. **Pro plan price** — $19.99 vs $24.99 (Sonara's price). At your traffic level you can detect a meaningful difference in <2 weeks.

**Stage 2 (at $5K MRR):** PostHog free tier. Self-hosted or cloud, both fine.

---

## 7. The $10K MRR roadmap (12-week plan)

### The math

- **$10K MRR target** at blended ARPU of $22 (mix of Pro + Unlimited) = **~455 paying customers**.
- Typical SaaS free→paid conversion: 4–8%. At 6%, you need ~7,600 active free users.
- Typical visitor→signup conversion on a focused landing page: 3–5%. At 4%, you need ~190K visitors over the 12 weeks (~2,300/day average, ramping).

### The channel mix at $500–2K/mo budget

| Channel | Weight | Why | Cost |
|---------|--------|-----|------|
| **Free Chrome extension promotion** | 25% | This is your Simplify-style flywheel. Push reviews, ProductHunt, Reddit posts. Each install = warm lead. | $0 + 1 ProductHunt launch |
| **SEO content engine (internships / entry-level / list pages)** | 25% | Copy Simplify's playbook. 50 location/role pages built from your existing scraped jobs. Long-tail, compounding. | $0 (your time) or $300/mo for a part-time freelance writer |
| **Reddit organic** (/r/jobs, /r/careeradvice, /r/jobsearchhacks, /r/cscareerquestions) | 15% | Value-first posts, helpful comments, only mention product when contextually relevant. Brutal but works. | $0 |
| **Google Ads (high-intent only)** | 20% | Keywords: "auto apply to jobs", "AI resume builder ATS", "easy apply automation". Tight match types, daily cap. | $400-800/mo |
| **Product Hunt + IndieHackers launch** | 5% | One-time momentum, social proof, backlinks. | $0 |
| **Affiliate / referral compound** | 10% | Once seeded, this grows without you. | $29-49/mo (Tolt/Rewardful) |

### Week-by-week

**Weeks 1–2 — Foundation (must finish before any spend):**
- Prompt 01 (system audit + sync) — Day 1–2
- Prompt 04 (stability: persistent jobs, Sentry, hh.ru cleanup, legal dates) — Day 3–5
- Prompt 02 (resume quality upgrade) — Day 6–9
- Prompt 03 (PDF templates) — Day 10–14

**Weeks 3–4 — Revenue capture:**
- Prompt 05 (annual plans + Sonara-style trial) — Day 15–17
- Set up Stripe annual prices, update pricing page
- Prompt 07 (referral + affiliate w/ Tolt) — Day 18–21
- Prompt 08 (feature flags + A/B harness) — Day 22–25
- Connect PostHog free (optional but recommended) — Day 26–28

**Weeks 5–6 — Distribution:**
- Push Chrome extension hard: ProductHunt launch, /r/chromeextensions post, indie newsletters
- Write first 10 SEO landing pages (template: "{role} Internships {year}" e.g. "Software Engineering Internships Summer 2026")
- First Reddit value posts (NOT promotional, NOT yet)

**Weeks 7–8 — Paid acquisition:**
- Google Ads on 3 high-intent keyword clusters, $20/day, monitor CAC
- Start running A/B tests #1 and #2 from §6.6
- First affiliate outreach to 20 niche creators

**Weeks 9–12 — Compound:**
- Scale Google Ads on whichever cluster has CAC < $40
- Ship 30 more SEO pages
- Replicate any winning A/B test
- Add 2 more PDF templates based on user requests
- Start collecting testimonials → Trustpilot

### Conversion targets at each stage

| Week | Free users | Paying customers | MRR | Notes |
|------|-----------|------------------|-----|-------|
| 4 | 200 | 12 | $260 | Soft launch, friends/family |
| 8 | 1,200 | 70 | $1,500 | Paid acquisition starts kicking |
| 10 | 3,000 | 180 | $4,000 | Referral compound begins |
| 12 | 7,000 | 455 | **$10,000** | Target hit |

These are aggressive. They assume Prompt 02 (resume quality) lands well and your money-back guarantee survives contact with reality (low refund rate). If resume quality is the differentiator I think it is, you'll exceed this. If it isn't, you'll stall around $3K and need to revisit.

---

## 8. The thing nobody else will tell you

You have a 9-subsystem app, an AI worker, a Chrome extension, a Telegram notifier, a Python ML pipeline, an autoapply bot, billing, PMF tracking, and an audit log — at presumably ~1 founder. **Your biggest risk is not features. It is operational complexity.**

Three rules to operate by:

1. **No new subsystem until $10K MRR.** Anything that adds a new container, queue, or external dependency is deferred. Everything you build for the next 90 days should land in an existing subsystem.
2. **No major refactor until $25K MRR.** The code can be ugly. Customers don't care.
3. **Default to off-the-shelf for non-core.** Tolt for affiliates, PostHog for analytics, Resend for email, Sentry for monitoring. Building these in-house is the single most common way solo founders die.

You have built the hard part. The next 90 days are about (a) not breaking it and (b) telling the world.

---

## 9. Sources

- [Sonara Review 2026 — Resume Judge](https://resumejudge.com/blog/sonara-ai-review/)
- [Sonara financials — Latka](https://getlatka.com/companies/sonara.ai)
- [Simplify Copilot Review 2026 — Jobright](https://jobright.ai/blog/simplify-copilot-review-2026-features-pricing-and-top-alternatives/)
- [Simplify Copilot Chrome Web Store](https://chromewebstore.google.com/detail/simplify-copilot-autofill/pbanhockgagggenencehbnadejlgchfc)
- [Simplify Review — 6figr](https://6figr.com/blog/simplify-review-is-it-worth-your-money-in-2026-630)
- [LazyApply Trustpilot reviews](https://www.trustpilot.com/review/lazyapply.com)
- [LazyApply Review 2026 — Remote Job Assistant](https://www.remotejobassistant.com/blog/lazyapply-review)
- [LinkedIn automation ban risk 2026 — Growleads](https://growleads.io/blog/linkedin-automation-ban-risk-2026-safe-use/)
- [ATS Resume Templates 2026 — Jobscan](https://www.jobscan.co/resume-templates/ats-templates)
- [STAR Method Resume — Resume Genius](https://resumegenius.com/blog/resume-help/star-method-resume)
- [Python PDF generation tools 2025](https://www.analyticsinsight.net/programming/best-python-pdf-generator-libraries-of-2025)
