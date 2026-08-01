# Owner checklist — only you can do these

Current as of **2026-07-31** (updated after Phases 3 & 4 shipped). Everything not on this list is either done or is
mine to do. Ordered so the things that unblock the most come first.

Anything already handled has been removed, not left ticked — this is a to-do
list, not a history. History lives in `docs/MASTER_PLAN.md` → LOG.

---

## 1. Inbound email — ONE DNS record left

**Status: webhook done (thank you), MX record still missing. Until it exists,
inbound mail cannot be delivered and this stays broken.**

### Done

Resend webhook created and enabled, listening for `email.received`, pointing at
`https://resumeai-bot.com/api/inbox/inbound`. I have already updated the signing
secret in production to match it, so that side is wired.

### Not done — this is the blocker

`resumeai-bot.com` has **no MX record**. Checked just now:

```
resumeai-bot.com        MX   (none)
inbox.resumeai-bot.com  MX   (none)
send.resumeai-bot.com   MX   10 feedback-smtp.us-east-1.amazonses.com
resumeai-bot.ru         MX    9 inbound-smtp.us-east-1.amazonaws.com
```

The record on `send.` is the **outbound bounce** record Resend adds for sending.
It does not receive anything. The `.ru` record is the old inbound one — the
domain Resend no longer accepts, which is why mail has gone nowhere since
22 July.

### What to do

0. **FIRST: turn "Enable Receiving" ON.** In Resend → Domains →
   `resumeai-bot.com`, scroll to the bottom. There are three sections: Domain
   Verification, **Enable Sending** (toggle green), and **Enable Receiving**
   (toggle grey/off). *Receiving is off.* Resend does not show you the inbound
   MX record until you turn it on — which is why you could not find one to add.

   **This is the whole blocker.** Everything else on the email side is done.

   ⚠️ Common mistake, already hit once: the MX under **Enable Sending** with the
   name `send` pointing at `feedback-smtp.us-east-1.amazonses.com` is the
   *outbound bounce* record. It is for sending, it already exists, and adding it
   again gives you "An identical record already exists". It is **not** the
   inbound record and it will never make receiving work.

1. **Then Resend shows the inbound MX.** Under the now-enabled Receiving
   section it will show an MX record, almost certainly
   `inbound-smtp.us-east-1.amazonaws.com` priority `10`, and tell you which
   hostname to put it on (`@` or a subdomain).
2. **Cloudflare → DNS → Add record → MX**, exactly as Resend shows. Proxy does
   not apply to MX records.

   The **Name** field is the part that matters. For the root domain it is `@`
   (Cloudflare may display this as `resumeai-bot.com`). It is **not** `send` —
   that is the sending record above. Getting this wrong is the difference
   between "identical record already exists" and inbound actually working.
3. Check it:

   ```bash
   dig +short MX resumeai-bot.com @1.1.1.1
   ```

4. **Tell me** and I will flip `INBOX_DOMAIN` on the VPS and send a test through.

I have deliberately not flipped `INBOX_DOMAIN` to `.com` yet: with no MX record
it would point every user's alias at a domain that receives nothing, which is
worse than the current state.

### Why it is worth doing before launch

It is what makes "every application is confirmed by the employer" true.
Greenhouse confirms by emailing an 8-character security code to the user's
alias. Right now autoapply tailors the resume, fills the form, reaches the
submit button, and fails — honestly recorded as FAILED, never as applied, but
failed. Fixing this turns those into confirmed submissions.

### It cannot rot silently again

The ops self-check now alerts your Telegram if no inbound message arrives for
three days. It is live and currently firing, correctly:

```
{"ok": false, "failures": ["no inbound mail for 8 days (newest 2026-07-22) —
 check the MX record for INBOX_DOMAIN and that the domain is still added in Resend"]}
```

---

## 2. Chrome Web Store submission — the biggest blocker after the inbox

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

## 3. Trust assets — the last open Phase 1 item

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

## 4. LAUNCH40 — decide what happens to it

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

**Added 2026-07-31:** the new Resend inbound webhook signing secret was visible
in a screenshot shared in chat. It is set correctly in production and everything
works, so this is not urgent — but rotate it in Resend when convenient, and tell
me so I can update the VPS at the same time.

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

## 8. Both A/B tests are now RUNNING — nothing to do, just know they exist

I turned both on at 50% and verified both arms in a real browser.

| flag | variant B | status |
|---|---|---|
| `landing_hero_b` | Homepage headline: *"Every application here is confirmed by the employer. Or it does not count."* | live, 50% |
| `pricing_headline_b` | `/pricing` headline: *"30 days to change your mind. No questions asked."* | live, 50% |

Read the result once traffic accumulates:

```bash
npx tsx scripts/experiment_results.ts landing_hero
```

It prints exposures, conversions and a p-value. Under p < 0.05 you have a
winner — ship it by setting that flag to 100 (variant B) or 0 (control) in
**Dashboard → Admin → Feature Flags**.

**Honest expectation:** at current traffic this needs weeks, possibly longer
than it is worth waiting. It exists so that when traffic arrives the
measurement is already running, not so you can check it daily.

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
