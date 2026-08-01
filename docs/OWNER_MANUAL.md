# What only you can do

Written 2026-08-01, after the launch-readiness audit. Everything not on this
list is done, deployed and verified in production.

Ordered by value. Items 1–2 are the only ones blocking paid traffic.

---

## 1. Stripe: fix what customers see on their bank statement · 5 min

**Why it matters more than it sounds.** Your Stripe account descriptor is
`MAXIM` and your merchant name renders as `Resume ai` (lowercase). A stranger
who pays $4.99 sees a person's first name on their statement, does not recognise
it, and disputes the charge. Each dispute costs the sale, a ~$15 fee, and your
standing with Stripe.

I could not do this: the API refuses descriptor changes on your own account
("you may only use it on connected accounts"). It is dashboard-only.

I did fix the half I could — the $4.99 tripwire charge now stamps `RESUMEAI`
via the payment intent. Subscriptions still inherit the account default, which
is what you are fixing here.

**Steps**

1. Go to https://dashboard.stripe.com/settings/public
2. **Statement descriptor** → `RESUMEAI`
   Save. (5–22 characters, letters/numbers/spaces only.)
3. On the same page, **Public business name** → `ResumeAI`
   This is the "Resume ai" that appears at the top of your checkout page.
4. Confirm **Customer emails → Successful payments** is ON at
   https://dashboard.stripe.com/settings/emails — receipts reduce disputes.

**How to check it worked:** open any checkout link; the header should read
`ResumeAI`, not `Resume ai`.

---

## 2. Chrome Web Store submission · ~1 hour, then 1–3 days of review

This is the last thing blocking Phase 2. The extension is built, tested and
guarded; it just is not published, and until it is, every "Add to Chrome" CTA on
the site renders nothing (deliberately — no dead links).

**Steps**

1. Pay the one-time $5 developer registration at
   https://chrome.google.com/webstore/devconsole
2. Zip the `extension/` directory (contents at the top level, not a wrapper
   folder).
3. Upload as a new item. You will need: 128×128 icon, 1–5 screenshots at
   1280×800, a short description, and a privacy policy URL — use
   `https://resumeai-bot.com/privacy`.
4. Under **Privacy practices**, declare: reads the job posting page you are on;
   sends it to resumeai-bot.com to tailor your resume; stores an API key.
   Be literal — vague answers are the main cause of rejection.
5. Submit. Review is usually 1–3 days.
6. When approved, copy the extension ID from the store URL and tell me. I set
   `NEXT_PUBLIC_CHROME_EXTENSION_ID` and every CTA appears automatically.

---

## 3. Two things I cannot test without you · 20 min, together

Both need your credentials, so they need you at the keyboard. Tell me when you
have twenty minutes and we do them in one pass.

- **Google OAuth signup.** I can drive the browser but will not enter your
  password. We confirm: sign-in works, the welcome email arrives, onboarding
  loads, the resume importer prefills, and a PDF renders in all five templates.
- **Pro upgrade.** Needs an authenticated session. We run a $0-promo
  subscription, confirm the quota gates open (25/day, all templates), the
  customer portal loads, cancellation works and the gates close again. I delete
  the promo afterwards, as I did for the tripwire.

---

## 4. Trust assets · 30 min

`lib/proof.ts` is deliberately empty. It stays empty until these exist — the
product does not ship fake proof, and that rule is the whole brand.

- **A photo of you** for the founder block on the landing page. A plain headshot
  is fine. Drop it in `public/` and tell me the filename.
- **One real ATS confirmation screenshot**, with the candidate's permission —
  yours is fine. Redact the name if you like; the point is the confirmation, not
  the person.

These are the highest-converting assets on the site and the only ones I cannot
manufacture.

---

## 5. First users · your call on timing

Organic search takes 2–8 weeks to ramp from indexing. If you want signal this
week, the fastest legitimate channel is you, manually:

- Post the free fit check in r/jobsearchhacks, r/resumes, and one or two Discord
  job-search servers. Lead with the honest bit — "it tells you what is missing
  and it does not claim to have applied when it has not". That framing is the
  differentiator; it is also true.
- 10–20 beta users on free Pro in exchange for feedback and, if they are happy,
  a testimonial. That is what unblocks item 4 permanently.

---

## Things you might expect to be here, and are not

- **`support@` forwarding** — done. It was silently discarding mail; now
  forwarded to `maksimabramov105@gmail.com` (from `ADMIN_EMAILS`) plus a
  Telegram alert. Verified: probe at 13:28:43, forwarded at 13:28:49.
- **Inbound email / MX** — done and verified by round-trip.
- **The A/B tests** — both live at 50%.
- **`OWNER_EMAIL`** — not needed; the forward falls back to `ADMIN_EMAILS`.
