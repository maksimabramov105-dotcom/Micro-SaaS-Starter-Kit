# Product-market fit framework — ResumeAI

> **Why this doc:** You can't ship Tier 1/2/3 features blindly. Without a way to read the signal, every change is a guess. This doc defines the signal precisely.
>
> **TL;DR:** ResumeAI has PMF when **paying users get more interviews per month than they would without you, AND they tell their friends.** Everything below is mechanics for measuring that.

---

## 1. The PMF signal — three layered tests

PMF is one of those things people argue about, but for a consumer subscription product like yours, three signals together are decisive. If all three are green for 60 consecutive days, you have PMF. If one is red, you don't — adjust the product, don't scale marketing.

### Test 1: The outcome metric (the only one that actually matters)

**Interview rate per paying user per month.**

- Define an "interview" as: a job application submitted via ResumeAI → followed by a recruiter reply with positive intent within 30 days. You'll detect this in the auto-triage feature (Tier 3 P4); until then, ask users via in-app survey on day 30: *"Did you get any interview requests this month from applications we sent?"*
- Baseline (without any service): typical job seeker gets ~5% interview rate on cold applications.
- **Target: ≥10% per paying user.** Below that, the product isn't doing meaningfully better than the user could do themselves manually.
- **Cohort tracking:** new paying users per week, track their interview rate at week 4. If the cohort dated post-Tier-1 launch shows ≥10% and pre-Tier-1 showed <5%, you've proven your changes work.

### Test 2: The retention curve (proves the value is sustained)

Plot **% of paying users still subscribed after N months**, where N goes 1, 2, 3, 6.

| Month | Healthy SaaS | Red flag below | Why this matters for ResumeAI |
|---|---|---|---|
| 1 | ≥85% | 70% | First-month churn is the trial conversion test. Lower than 70% = product doesn't deliver fast enough. |
| 3 | ≥65% | 50% | At month 3, users either got hired (good — they churn but happy) or got nothing (bad — they churn unhappy). Distinguish via exit survey. |
| 6 | ≥40% | 25% | "Long-tail" job seekers. If too high, your users aren't getting hired at all (bad for them; eventually bad for you via word of mouth). If too low and quickly, you may be losing them before they got value. |

**ResumeAI-specific nuance:** unlike most SaaS, your product is *meant* to be temporary. A healthy churn at month 3 with a "I got a job" exit reason is GOOD. Track exit reasons:

- 🟢 "I got a job" → ideal exit. Ask for testimonial + referral.
- 🟡 "Too expensive" → pricing issue.
- 🔴 "Didn't get interviews" → product issue, the biggest red flag.
- 🔴 "Too many spam/low-quality applications sent" → quality issue.
- 🟡 "I didn't use it enough" → onboarding issue.

### Test 3: The referral coefficient (proves word-of-mouth works)

**For every 10 users who got a job through ResumeAI, how many of their friends sign up because of them?**

- Run a referral program: existing user gets 1 free month per friend who signs up, friend gets 50% off first month.
- Measure: `referred_signups / users_who_got_jobs_last_month`. Healthy: ≥0.5 (every 2 jobs found = 1 new signup). Strong: ≥1.0. PMF-level: ≥2.0.
- Don't conflate viral coefficient with this. You don't need every user to bring a friend; you need *successful outcomes to drive signups*. That's the loop that compounds.

---

## 2. The dashboard you need to live in

Build a single internal page at `/admin/pmf` that shows these 12 numbers, updated daily. This is the only dashboard the founder needs to look at.

```
┌──────────────────────────────────────────────────────────────────┐
│  ResumeAI — PMF dashboard                       Today: 2026-MM-DD │
├──────────────────────────────────────────────────────────────────┤
│  TODAY                                                            │
│   • New signups (free):          X                                │
│   • Free → Paid conversions:     X                                │
│   • Cancellations:               X                                │
│   • Net new MRR:                 $X                               │
│                                                                   │
│  LAST 30 DAYS                                                     │
│   • Applications submitted:      X     [success rate %]           │
│   • Apps with positive reply:    X     [interview rate %]         │
│   • Apps marked "got job":       X                                │
│   • Refunds issued:              X     [refund rate %]            │
│                                                                   │
│  COHORT — paying users who joined 30/60/90 days ago               │
│   • Still subscribed at D30:     X%                               │
│   • Still subscribed at D60:     X%                               │
│   • Still subscribed at D90:     X%                               │
│                                                                   │
│  REFERRAL LOOP                                                    │
│   • Got-a-job exits this month:  X                                │
│   • Referrals from them:         X     [coefficient]              │
└──────────────────────────────────────────────────────────────────┘
```

Implement in the **Dashboard / tracking** block as `app/admin/pmf/page.tsx`, gated by admin email check. Data comes from existing Postgres tables — no new schema needed for the first 10 metrics. The interview rate metric needs an in-app "Did you get an interview?" survey shipped to month-1 paying users.

---

## 3. When to declare PMF (and what changes if you do)

PMF criteria, all three for 60 consecutive days:

- ✅ Interview rate per paying user ≥ 10%
- ✅ D30 retention ≥ 70%, D90 ≥ 40%
- ✅ Referral coefficient ≥ 0.5

**Before PMF:** spend on *product*, not paid acquisition. Every dollar on Google Ads before PMF leaks out faster than you can refill the bucket.

**After PMF (all three green):** open the paid acquisition tap. Your unit economics will work because retention is real. CAC:LTV becomes a math problem instead of a hope.

---

## 4. Negative signals that should make you pause

If any of these happen, stop and investigate before adding features:

| Signal | What it likely means | First fix |
|---|---|---|
| Sub-2% submission success rate | Scrapers are broken or LinkedIn blocking | Look at worker logs per source; Sender block |
| >15% refund rate | Money-back guarantee being abused OR product genuinely bad | Read every refund-reason; if "didn't get interviews" dominates, Tier 1 features urgent |
| D30 retention <50% | Users see the product, don't get value, leave fast | Onboarding + first-week interview signal |
| Strong refund rate AND negative reviews mentioning "spammy applications" | You're in the volume-trap Sonara is in | Reduce daily quota defaults; ship Tier 1 quality features |
| Active users / signups ratio dropping | You're acquiring the wrong people | Marketing channel quality; revisit ICP |

---

## 5. Concrete next 30-day metrics targets

You're at week 0 of having a clean, English, deployable system. By day 30 you should have:

- 100+ free signups
- 10+ paid conversions
- ≥1,000 applications submitted across all users
- Daily PMF dashboard populated and reviewed each morning
- Interview-rate survey live and answered by ≥30 users
- Refund rate < 10%
- D7 retention (very early) ≥ 60%

Hit these and you've earned the right to start spending on ads. Miss them and you have specific things to fix that are not "more marketing."
