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

## 4. Bing — 2 minutes, currently half-done

You added `resumeai-bot.com` to Bing Webmaster Tools. Finish it:

1. **https://www.bing.com/webmasters** → your site → **Sitemaps**
2. Submit `https://resumeai-bot.com/sitemap.xml`

Bing feeds DuckDuckGo, Ecosia and ChatGPT search, so it is worth more than its
market share suggests. IndexNow is already wired and accepting all 301 URLs.

---

## 5. Telegram alerts for the uptime monitor (optional, recommended)

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

## 6. Security hygiene — rotate what was shared in chat

1. **Revoke the old GitHub PAT.** I removed it from `.git/config`, but it still
   exists on GitHub until you revoke it:
   **https://github.com/settings/tokens** → find the old `ghp_…` → Delete.
2. **Rotate the Cloudflare API token** you created for the migration:
   **https://dash.cloudflare.com/profile/api-tokens** → Roll or Delete.
3. **Rotate the R2 keys** if they were pasted in chat.

None of these are currently exploitable through the app, but a credential that
has appeared in a chat log should not stay valid.

---

## 7. First users — the actual bottleneck now

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

## 8. Optional: turn on the pricing-page speed fix

Not blocking anything, but worth knowing. Lighthouse on the new domain:

| page | perf | SEO |
|---|---|---|
| `/` (landing) | **99** | 100 |
| `/ats-check` | 97 | 100 |
| `/resume-rescue` | 96 | 100 |
| `/pricing` | **72** | 100 |

`/pricing` is the money page and the slowest. The code is not slow — server
response 190 ms, TBT 70 ms, CLS 0. It renders dynamically because it assigns an
A/B variant server-side, so it gets none of the static caching the other pages
do, and LCP lands at 5.4 s.

Fixing it means moving variant assignment client-side so the shell can be
static. Say the word and I will; I have left it alone because it changes how the
pricing experiment works and that is a product decision, not a technical one.

---

## Done recently — no action needed

Domain migration to `.com` (site, email, crons, sitemap, canonicals) · Search
Console change-of-address confirmed and running · Resend verified on `.com` ·
DMARC added · OAuth redirect URIs updated · `workflow` scope granted · all 10
dependency PRs merged · 9 orphaned Stripe prices archived · uptime monitor live ·
scraper description capture shipped.
