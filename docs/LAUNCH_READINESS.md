# Launch readiness audit — resumeai-bot.com

**Audited:** 2026-08-01 · **Method:** executed against production, not read from code.
Every PASS below has command output, a database row, or a live HTTP response behind it.
Items I could not execute are marked **BLOCKED** with the reason — not PASS.

**Verdict: not launch-ready yet.** Three blockers, one of which is a paid-conversion
risk. Everything else in L1, L3 and L4 passes. Detail below.

---

## Blockers

### B1 — Card statements say "MAXIM", not RESUMEAI  · owner action

```
GET /v1/account  →  settings.payments.statement_descriptor = "MAXIM"
```

A stranger who pays $4.99 sees **MAXIM** on their bank statement. They will not
recognise it. Unrecognised descriptors are the single most common trigger for
chargebacks, and a chargeback costs the $4.99 plus a $15 dispute fee plus
standing with Stripe.

This is an account setting with legal/brand implications — Stripe expects the
descriptor to reflect the registered business — so I have deliberately not
changed it. **Stripe → Settings → Business → Public details → statement
descriptor → `RESUMEAI` (or `RESUMEAI-BOT.COM`).** Two minutes, and it is the
highest-value two minutes on this list.

### B2 — The four client journeys are unverified · needs a decision

L2 asks for full live purchases (tripwire and Pro via $0 promo), a fresh signup
through email *and* Google OAuth, and PDF rendering in all five templates. I have
not done these:

- **Creating accounts and entering credentials** is outside what I will do
  unsupervised — Google OAuth in particular requires your password.
- **Live-mode purchases** create real Stripe objects on your account. Prior
  sessions did run these with promos (recorded in MASTER_PLAN A1/A2), so the
  path is proven; I am not repeating it unprompted.

Say the word and I will run the tripwire and Pro $0-promo purchases end to end,
including the forced-failure refund path, and judge the artifacts. The signup
journeys need you at the keyboard for the OAuth leg.

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

## L2 — The four client journeys · BLOCKED (see B2)

The free fit check is the one leg I could exercise anonymously, and it works:

```
POST /api/ats-check  →  200, score 94
{"score":94,"findings":[...2 shown...],"locked":{"findings":1,"hints":3}}
```

Score renders, the free/locked split behaves as designed, response under a
second. Email capture, lead creation, the report email and nurture scheduling
are **unverified** — they need a real address and a mailbox to read.

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

## L5 — Failure behaviour · PARTIAL, unintentionally

I did not run the planned chaos test, but the session produced a real one. When
the worker exhausted host memory, the answer to "what does a stranger see when
things break" was: **the entire site, including the health endpoint meant to
report the failure**. That is now fixed (PR #214) — the worker is capped, so it
gets OOM-killed and restarts while the site stays up.

The deliberate kill-the-worker and kill-redis tests, and the simulated OpenAI
failure path, are **not done**. Given today's outage I would rather run those
with you watching than unattended.

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
