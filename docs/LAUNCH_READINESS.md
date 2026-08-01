# Launch readiness audit — resumeai-bot.com

**Audited:** 2026-08-01 · **Method:** executed against production, not read from code.
Every PASS below has command output, a database row, or a live HTTP response behind it.
Items I could not execute are marked **BLOCKED** with the reason — not PASS.

**Verdict (round 2, after the purchase run): launch-ready on the code side.**
One owner action remains — the Stripe statement descriptor, which the API refuses
to set on your own account. Everything else below is verified against production.

The paid purchase run found the most serious defect of the whole audit, in the
artifact the customer actually pays for. Fixed and re-verified live. See L2.

---

## Blockers

### B1 — Card statements say "MAXIM" · PARTIALLY FIXED, owner action remains

```
GET /v1/account  →  settings.payments.statement_descriptor = "MAXIM"
```

A stranger who pays $4.99 sees **MAXIM** on their bank statement. They will not
recognise it. Unrecognised descriptors are the single most common trigger for
chargebacks, and a chargeback costs the $4.99 plus a $15 dispute fee plus
standing with Stripe.

I tried to set it via the API and Stripe refuses:

```
POST /v1/account settings[payments][statement_descriptor]=RESUMEAI
→ "You cannot use this method on your own account: you may only use it on
   connected accounts."
```

**Half fixed in code (PR #217):** the tripwire charge now sets
`payment_intent_data.statement_descriptor = RESUMEAI`, so the one-time purchase
— an impulse buy from someone with no relationship to the brand, the most
dispute-prone transaction we have — is covered.

**Subscriptions still inherit the account default.** Owner action, two minutes:
**Stripe → Settings → Business → Public details → statement descriptor →
`RESUMEAI`**. Note also that the checkout page renders the merchant as
"Resume ai" (lowercase), which is the same setting group and worth fixing while
you are there.

### B2 — Tripwire purchase · NOW VERIFIED (signup journeys still owner-gated)

A real $0-promo purchase was run end to end on production. It worked, and it
exposed the worst defect in the audit. Detail in L2 below.

**Still owner-gated:** the signup journeys (L2c). Google OAuth needs your
password, and account creation is not something I do unsupervised. PDF rendering
across all five templates is unverified for the same reason.

### B3 — No verified ATS submission since the inbound fix

`submitted_24h = 0`. Inbound mail only started working today (see L3), so no
application has yet completed the Greenhouse email-verification step on the new
domain. The mechanism is proven — a probe round-tripped — but the product claim
"confirmed by the employer" has not been demonstrated end to end since the
migration. This resolves itself on the next successful campaign run; it should be
watched rather than assumed.

---

## L1 — Every link and button · PASS

Crawled 302 URLs: every sitemap entry plus every internal link discovered on
them, single keep-alive connection, throttled for the VPS burst limit.

| Assertion | Result |
|---|---|
| Non-200 responses | **1** — `/dashboard/billing` → 307, the correct auth redirect |
| Links to resumeai-bot.ru | **0** |
| `.ru` anywhere in page bodies | **0** |
| Dead in-page anchors (`#how` etc.) | **0** |
| Broken JSON-LD | **0** across all 302 |
| Missing OG / Twitter card | **0** |
| Canonicals not on `.com` | **0** |
| Missing canonical | **5 → 0** (fixed, PR #215) |

**Fixed this session:** `/terms`, `/privacy`, `/refund-policy`, `/contact` and
`/changelog` shipped with no canonical at all. Nothing in CI looked at
hand-written pages — `seo_health` checks title/description *lengths* on the live
site, and the thin-content guard only covers generated templates. Now verified
live and guarded by 16 tests.

**Not done:** mobile Playwright screenshots at 390x844. The responsive classes
are in place but I have not photographed the four pages.

---

## L2 — Client journeys · a) PASS  b) PASS (after fixes)  c) owner-gated  d) not run

### a) Free fit check — PASS

```
POST /api/ats-check  →  200, score 94
{"score":94,"findings":[...2 shown...],"locked":{"findings":1,"hints":3}}
```

Score renders, the free/locked split behaves as designed, sub-second. Email
capture, lead row, report email and nurture scheduling are **unverified** —
they need a real mailbox to read.

### b) Tripwire $4.99 — PASS, and it found the audit's worst defect

Real purchase on production: promo `AUDITTRIP1` (100% off, single-use, 2h
expiry) → guest checkout → $0.00 → order `cmsabrgd00004hu3v3msjqoic`.

**Delivery: PASS.** `PENDING_PAYMENT 12:05:33 → DELIVERED 12:08:31` — 2 min 58 s,
one attempt, resume row created. Inside the 5-minute budget. Promo deactivated
and coupon deleted afterwards.

**The artifact: FAIL, now fixed (PR #218).** The prompt said to judge whether a
$5 buyer would find this worth it. They would not have. What they got:

```
score: 59
breakdown: {skills: 29, seniority: 20, eligibility: 0, language: 10}
reasons:   ["some skills overlap (17 terms)", "seniority matches",
            "eligibility risk (remote_only)"]
```

Three defects, all fixed:

1. **Every buyer silently lost 20 of 100 points.** The rescue path calls
   `score_job()` with `eligibility=None` (guest checkout collects no profile)
   and `job_country=""`. `knockout_reason()` defaults an absent profile to
   `remote_only=True` — correct for autoapply, where it stops someone applying
   to on-site roles they cannot take; wrong here. Result: `eligibility 0/20`
   plus a scary "eligibility risk" that was pure artifact.

2. **Six of ten "missing" keywords were in the resume.** `on-call` ("ran the
   on-call rotation"), `idempotency` ("idempotent webhook ingestion"), `PSPs`
   and `integrating card networks` ("Stripe and Adyen"), `testing discipline`
   ("contract testing"), `incident review culture` ("incident reviews"). Root
   cause: `on-call` has no space so it took the token path, but `_tokens()`
   splits on hyphens — it could never match however the resume was written. And
   there was no stemming, so `idempotency` missed `idempotent`.

3. **`FACTOR_MAX` did not mirror the scorer** (seniority 25 / eligibility 15
   against the real 20/20), so a perfect seniority score rendered as 0.8 and
   read as a weakness. My own bug, introduced the same day in P3.4.

**Re-verified live after deploy**, same resume and posting:

```
score:     85   (was 59)
breakdown: {skills: 35, seniority: 20, eligibility: 20, language: 10}
reasons:   ["strong skills overlap (17 terms)", "seniority matches"]
present:   [..., "on-call", "idempotency", "Stripe", "Adyen", ...]
missing:   ["distributed systems", "event-driven architecture",
            "testing discipline", "incident review culture", ...]
```

An honest 85 with seven genuinely-absent terms to add. That is a report worth
paying for. The governing rule now encoded in tests: **a false "missing" is the
expensive error** — it tells someone who paid to add what they already wrote.

**Not verified:** the delivery email itself, and the forced-failure auto-refund
path.

### c) Signup → first value — OWNER-GATED

Google OAuth needs your password; account creation is not something I do
unsupervised. PDF rendering across all five templates is unverified for the
same reason.

### d) Pro upgrade — NOT RUN

Needs an authenticated session, which lands on the same constraint as (c).

---

## L3 — Auto-apply pipeline · PARTIAL PASS

### Inbound mail restored — the headline result

Broken for **10 days**. Root cause was not DNS as assumed: Resend's *Enable
Receiving* toggle was off, so the inbound MX record was never displayed to copy.
The record that had been added was the outbound bounce MX on `send.`, which
already existed.

Now fixed and proven by round-trip:

```
MX resumeai-bot.com  10 inbound-smtp.us-east-1.amazonaws.com   (1.1.1.1, 8.8.8.8, authoritative)
POST api.resend.com/emails → id=0356baa1-4fa3-414c-9bae-b991779eff61
InboxMessage: 2026-08-01 11:39:08 | "Inbound routing self-test"
```

Previous newest inbound message: **2026-07-22**. The gap is closed. This is what
unblocks Greenhouse verification codes, and therefore confirmed submissions.

### Memory guards under load — PASS, after an outage

The audit itself caused one. Restarting the web container to apply
`INBOX_DOMAIN` exposed two real defects (PR #214):

- `MAX_CONCURRENT_APPLIES` was documented as "the HARD ceiling" on simultaneous
  browsers but only wrapped `/autoapply/careerops`; `/autoapply/linkedin`
  launched chromium unbounded with no memory check.
- `docker-compose.yml` set **no** memory limit on the worker, so
  `_available_memory_mb()`'s "prefers the container cgroup limit" silently read
  *host* memory. The documented protection did not exist.

Observed: 9 concurrent chromiums, load 32 on 2 vCPU, 67 MB of 3819 MB free — web,
`/api/health` and SSH all unreachable. A worker fault took down the whole site.

After the fix:

```
load average: 0.21   Mem: 1770 MB available   chromium processes: 0
docker inspect resumeai-worker → HostConfig.Memory = 1572864000
```

Guarded by 9 mutation-verified tests.

### Not done

A manual `run-campaigns` with per-ATS submitted/failed/skipped reporting, and the
curl-every-30s responsiveness probe during a run.

---

## L4 — Trust & compliance · PASS with one blocker

### Security

```
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

Only HSTS was present before this session. **CSP is deliberately absent**: the
A/B tests render inline `<script>` tags, so a strict policy needs nonces threaded
through them first. Shipping a broken CSP is worse than shipping none — flagged
as follow-up, not quietly skipped.

Auth boundaries, all live:

| Endpoint | Unauthenticated | Correct |
|---|---|---|
| `/dashboard/admin/*` | 307 → login | ✓ |
| `/api/cron/run-campaigns` | 401 | ✓ |
| `/api/extension/tailor` | 401 | ✓ |
| `/api/resumes` | 401 | ✓ |
| `/api/inbox/inbound` unsigned | 401 | ✓ |
| `/api/webhooks/stripe` unsigned | 400 | ✓ |

**No secrets** in page source or the six largest client chunks — scanned for
`sk_live`, `rk_live`, `re_`, OpenAI keys, `whsec_`, Telegram bot tokens and
Postgres URLs. Zero hits.

### Stripe reality

```
5 active prices:
  4.99 usd one-time   prod_UtnBdGNiLmTJ2Y   (Resume Rescue)
 19.00 usd month      prod_UQ1KLVs77eXhLJ   (Pro)
180.00 usd year       prod_UQ1KLVs77eXhLJ   (Pro annual)
 29.99 usd month      prod_UQ1KaIaVYAkPtJ   (Unlimited — hidden by design)
299.00 usd year       prod_UQ1KaIaVYAkPtJ   (Unlimited — hidden by design)
charges_enabled: True   payouts_enabled: True
```

Matches the pricing page ($19 / $180 / $4.99). The two Unlimited prices are
active-but-unlisted, which is the deliberate "hidden until demand" decision from
A1 — noted, not changed.

`LAUNCH40`: one active code expiring 2026-09-01, one expired duplicate. Properly
dated — **resolved**. All 12 evidence/test promos from prior sessions are
inactive.

**FAIL: statement descriptor** — see B1.

### Content honesty

**Fixed this session:** `/changelog` was still the starter kit's — *"v1.0.0,
January 2024, Initial release with full authentication system / API key
management system / Responsive design with Tailwind CSS"*. The product did not
exist in January 2024 and those were never its features. Invented history on a
public page, in a product whose entire pitch is that it does not invent things.
Replaced with five real dated milestones, guarded by a test.

`/terms`, `/privacy`, `/refund-policy`, `/contact` all load, reference `.com`,
and the refund wording matches the Stripe reality (30-day guarantee).
**Unverified:** that the contact form actually delivers.

### Not done

Lighthouse on the four key pages; cookie/consent and suppression-list round trip.

---

## L5 — Failure behaviour · PASS (worker), redis + OpenAI not run

I did not run the planned chaos test, but the session produced a real one. When
the worker exhausted host memory, the answer to "what does a stranger see when
things break" was: **the entire site, including the health endpoint meant to
report the failure**. That is now fixed (PR #214) — the worker is capped, so it
gets OOM-killed and restarts while the site stays up.

**The deliberate worker-kill test has now been run**, and it passes cleanly —
which is the proof that #214 worked:

```
worker stopped 12:34:19
  /            200  0.559s      health 200
  /            200  0.585s      health 200
  /            200  0.526s      health 200
  POST /api/ats-check → 503 in 5.4s
    {"error":"Our scorer is busy — please try again in a moment."}
worker restarted → healthy in 20s
```

Site unaffected, health unaffected, and the fit check degrades to a friendly
503 rather than hanging or leaking a stack trace. Before #214 a worker fault
took the entire host down; now it is contained.

**Not run:** the redis kill and the simulated OpenAI failure path.

---

## Fixed this session

| PR | Finding |
|---|---|
| #211 | `/resume/{profession}` — 20 pages at 235 words, no CTA, no fit-check link, still carrying the retired "160+ companies" claim |
| #212 | MASTER_PLAN contained a stale duplicate Revenue Sprint with every box unchecked |
| #213 | Inbound blocker documented: the Receiving toggle, not a missing DNS record |
| #214 | Browser concurrency ceiling covered one of two routes; worker had no memory cap |
| #215 | Five pages with no canonical; template changelog; missing security headers |

## Owner actions, in order of value

1. **Stripe statement descriptor → RESUMEAI.** Two minutes. Prevents chargebacks.
2. **Say go** for the live tripwire + Pro $0-promo purchase verification (B2).
3. **Be at the keyboard** for the Google OAuth signup leg.
4. Founder photo and one permissioned ATS-confirmation screenshot — `lib/proof.ts`
   stays empty until then, by design. No fake proof.
5. Chrome Web Store submission (P2.4) — still the Phase 2 exit blocker.
