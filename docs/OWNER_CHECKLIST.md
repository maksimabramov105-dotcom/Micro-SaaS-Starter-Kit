# Owner checklist — only you can do these

Current as of **2026-07-31** (updated after Phases 3 & 4 shipped). Everything not on this list is either done or is
mine to do. Ordered so the things that unblock the most come first.

Anything already handled has been removed, not left ticked — this is a to-do
list, not a history. History lives in `docs/MASTER_PLAN.md` → LOG.

---

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

##