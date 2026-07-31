# Owner checklist — only you can do these

Current as of **2026-07-31** (updated after Phases 3 & 4 shipped). Everything not on this list is either done or is
mine to do. Ordered so the things that unblock the most come first.

Anything already handled has been removed, not left ticked — this is a to-do
list, not a history. History lives in `docs/MASTER_PLAN.md` → LOG.

---

## 1. Chrome Web Store submission — the single biggest blocker

**Why it matters:** Phase 2's exit criterion is literally *"extension approved in
Web Store"*. It also gates the "Add to Chrome" button, which is built and
waiting. Nothing else in Phase 2 is outstanding — the code is done, deployed and
tested.

**Time:** ~1 hour to prepare, then 1–5 business days of Google review.

1. Go to **https://chrome.google.com/webstore/devconsole** and sign in.
2. Pay the **one-time $5 developer registration fee** if you have not already.
3. Package the extension:
   ```bash
   cd ~/code/Micro-SaaS-Starter-Kit && zip -r ../resumeai-extension.zip extension -x "*.DS_Store"
   ```
4. **New item** → upload `resumeai-extension.zip`.
5. Fill the listing. These fields carry ranking weight in store search, so use
   the words people actually type:
   - **Name:** `ResumeAI — Job Application Autofill & Resume Tailoring`
   - **Short description** (132 chars max, most important field):
     `Autofill job applications on Greenhouse, Lever, Ashby and more. Tailor your resume for the exact role in one click.`
   - **Category:** Productivity
   - **Screenshots (1280×800):** show the extension *doing the thing* on a real
     Greenhouse form — the overlay button mid-autofill, and the tailor button.
     Do not use a logo or an abstract graphic; screenshots are the conversion
     lever on a store listing.
   - **Privacy policy URL:** `https://resumeai-bot.com/privacy`
6. **Privacy practices tab** — you must justify each permission or review
   bounces. Truthful answers:
   - `storage` → stores the user's ResumeAI API key locally.
   - `activeTab` / `scripting` → reads the job posting the user is looking at, to
     autofill and to tailor for it.
   - host permissions → the ATS domains the extension fills, plus
     resumeai-bot.com for the user's own resume data.
   - Data use: state that resume data is sent to resumeai-bot.com only, is not
     sold, and is not used for advertising.
7. Submit for review.

**When it is approved, tell me the extension ID** and I will set
`NEXT_PUBLIC_CHROME_EXTENSION_ID` — the "Add to Chrome" CTA then appears on the
landing page with no code change. (You can also set it yourself: add the line to
`/opt/resumeai/.env` and run `docker compose up -d web`.)

---

## 2. Trust assets — the last open Phase 1 item

**Why it matters:** P1.3 is deliberately unchecked. The vanity counters are gone
and `/proof` is linked, but there is no *positive* proof on the landing page.
I will not fabricate a testimonial or a screenshot, because the honesty framing
is the entire moat — a faked one destroys the thing being sold.

1. **Founder photo** → save as `public/founder.jpg` (square, ≥400×400). An
   initials avatar ships until it exists.
2. **One real ATS confirmation screenshot** — an actual "application received"
   email or ATS page. **Blank out the personal details.** If it is not your own
   application, get the person's permission first.
3. **A short demo GIF/video** (10–20s): open a real Greenhouse posting → click
   autofill → fields populate. This is the single most persuasive asset you can
   produce and it doubles as the store screenshot from step 1.

Drop them in `public/` and tell me; I will place them and re-check P1.3.

---

## 3. LAUNCH40 — decide what happens to it

**Live Stripe state:** `promo_1Th6TD…` is ACTIVE, 40% off, **0 redemptions**,
runs to **2026-09-01**. The banner auto-hides on that date, so nothing is
broken.

Two things to decide:

- **Keep, expire early, or make evergreen?** Zero redemptions in ~2 months
  suggests it is not pulling its weight as a launch offer.
- **The coupon is `duration: once` and applies to ANY plan.** I already changed
  the label to *"40% off your first payment"* because *"40% off your first year"*
  was **false for monthly subscribers** — they would get 40% off one month. If
  you want the stronger "first year" claim, restrict the coupon to the annual
  price in Stripe and tell me; I will change the copy back.

---

## 4. Telegram alerts for the uptime monitor (optional, recommended)

The uptime monitor is live and probing every 15 minutes from GitHub's runners.
It already emails you on failure. For phone alerts, add two repo secrets:

**https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/settings/secrets/actions**

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | your ResumeAI bot token |
| `TELEGRAM_CHAT_ID` | `6246429438` |

Also: if you have never pressed **Start** on the ResumeAI bot in Telegram, do it
once — Telegram refuses bot-initiated messages otherwise (403).

---

## 5. Security hygiene — rotate what was shared in chat

1. **Revoke the old GitHub PAT.** I removed it from `.git/config`, but it still
   exists on GitHub until you revoke it:
   **https://github.com/settings/tokens** → find the old `ghp_…` → Delete.
2. **Rotate the Cloudflare API token** you created for the migration:
   **https://dash.cloudflare.com/profile/api-tokens** → Roll or Delete.
3. **Rotate the R2 keys** if they were pasted in chat.

None of these are currently exploitable through the app, but a credential that
has appeared in a chat log should not stay valid.

---

## 6. First users — the actual bottleneck now

Everything technical for Phase 5 distribution is built (301 SEO URLs, `/proof`,
comparison pages, referral loop). What is missing is people, and that part is
yours.

- **Beta cohort (P5.4):** 10–20 users from r/jobs, r/resumes,
  r/cscareerquestions, r/jobsearchhacks, r/EngineeringResumes, Discord job-hunt
  servers. Offer free Pro in exchange for honest feedback + permission to quote.
- **How to post without being removed:** answer questions with data, do not drop
  links. You have something nobody else does — real verified-submission
  telemetry. *"We tracked 300+ verified ATS submissions; here is the actual
  reply rate"* gets upvoted. *"Try my tool"* gets removed. `/proof` is the
  landing page for exactly that traffic.
- **Product Hunt (P5.5):** wait until the extension is live **and** you have ~5
  real testimonials. Launching early into an empty room wastes the one shot.

See `docs/FREE_TRAFFIC_PLAYBOOK.md` for the full ordering.

---

## 7. Two A/B tests are built and waiting for you to switch them on

Both are off. Neither does anything until you turn it on, and turning one on
costs nothing and needs no redeploy.

**Dashboard → Admin → Feature Flags**, then set the rollout % and toggle:

| flag | what variant B changes | suggested % |
|---|---|---|
| `landing_hero_b` | Homepage headline leads with "every application is confirmed by the employer" instead of the resume artifact | 50 |
| `pricing_headline_b` | `/pricing` headline leads with the 30-day refund instead of "Simple, Transparent Pricing" | 50 |

A rollout of 0 or 100 means everyone sees one thing, so nothing is recorded —
use 50 to actually run a test. Changes take effect within 5 minutes, or
instantly with **Bust cache**.

To read the result once traffic has accumulated:

```bash
npx tsx scripts/experiment_results.ts landing_hero
```

It prints exposures, conversions and a p-value. Under p < 0.05 you have a
winner; ship it by setting that flag to 100 (or 0 to keep the control).

**Honest expectation:** with current traffic this will take weeks to reach
significance, and possibly longer than it takes to just pick one. It is here so
that when traffic does arrive, the measurement already exists.

---

## Done recently — no action needed

Domain migration to `.com` (site, email, crons, sitemap, canonicals) · Search
Console change-of-address confirmed and running · **Bing sitemap submitted** ·
Resend verified on `.com` · DMARC added · OAuth redirect URIs updated ·
`workflow` scope granted · all 10 dependency PRs merged · 9 orphaned Stripe
prices archived · uptime monitor live · scraper description capture shipped ·
**`/pricing` speed fix shipped** (was Lighthouse 72 / LCP 5.4 s because it
rendered dynamically to assign an A/B variant; assignment moved client-side and
the page is static again) · **autoapply seniority bug fixed** (every "… Manager"
title was read as the director rank, so three live campaigns scraped 518 jobs
and applied to none of them).
