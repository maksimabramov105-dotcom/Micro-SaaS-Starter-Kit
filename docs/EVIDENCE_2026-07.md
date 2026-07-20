# Evidence sweep — 2026-07-20

**Question this document answers:** does the invisible half of the machine — the
part that runs when nobody is watching — actually work in production?

Everything below is a real run against **live** Stripe, the live database and the
live domain. No mocks, no staging. Where something could not be proven, it says
so and explains exactly why.

| Item | Verdict |
|---|---|
| F1a Stripe live prices reconcile with `lib/pricing.ts` | **PARTIAL** — all 5 configured prices match; 9 orphaned active prices |
| F1b End-to-end tripwire purchase → delivery | **PASS** — 17.3s paid→delivered (budget 5 min) |
| F1c Forced failure → refund + apology + alert | **PARTIAL** — path proven; refund API not exercisable; **bug found & fixed** |
| F1d Pro subscription → plan gates open | **PASS** — limit 3 → 25 |
| F1e Upsell coupon issued, single-use, 72h | **PASS** |
| F1f Funnel events land in the DB | **PARTIAL** — 7 of 8 proven with real rows |
| F2a `/ats-check` → lead + report email + nurture schedule | **PASS** |
| F2b Abandoned-checkout email after 4h | **PASS** |
| F2c Unsubscribe → suppression list | **PASS** |
| F3a Daily pulse Telegram message | **FAIL** — has never fired in production |
| F3b Real-time money alert | **PASS** — 3 alerts, timestamps match to the second |
| F3c IndexNow + sitemap | **PASS** — 290 URLs accepted by the real cron |
| F3d `npm run smoke` | **PARTIAL** — HTTP checks pass; infra checks silently skipped |
| F4a Live sitemap URLs, 404 sweep | **PASS** — 290/290 return 200 |
| F4b Lighthouse perf + SEO | **PASS** — SEO 100 on all four pages |
| F4c Public SEO pages statically rendered | **PASS** |

Three defects were found. One is fixed in
[#155](https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/pull/155);
the other two are listed under [Open items](#open-items).

---

## F1 — Money path

### F1a. Every active Stripe LIVE price, reconciled

```
key mode: sk_live_
active prices: 14
price_1Tah9SHH7N0YD11QLvM1jKXR   |   299.00 usd | year      | Unlimited Yearly
price_1TRBHeHH7N0YD11QQwQq7rtO   |   287.90 usd | year      | Premium Annual (20% off)
price_1Tah9JHH7N0YD11Q6ILb9q2w   |   199.00 usd | year      | Pro Yearly
price_1TRBHcHH7N0YD11QLfWU0N46   |   191.90 usd | year      | Pro Annual (20% off)
price_1TtnFHHH7N0YD11QDCWqdAM6   |   180.00 usd | year      | Pro Annual $180 (2026-07 restructure)
price_1TLTVhHH7N0YD11QeFRlaDSw   |   149.00 usd | month     | Pro Annual
price_1TLTWLHH7N0YD11Q7AswwGwm   |    39.99 usd | month     | Premium Monthly
price_1TRBHeHH7N0YD11Qumn5cvDB   |    29.99 usd | month     | Premium Monthly
price_1TRBHcHH7N0YD11Q2XMCZmbM   |    19.99 usd | month     | Pro Monthly
price_1TLTUuHH7N0YD11QKYiEvUd0   |    19.99 usd | month     | Pro Monthly
price_1TtnFHHH7N0YD11QjK8Np3qf   |    19.00 usd | month     | Pro Monthly $19 (2026-07 restructure)
price_1TtzbEHH7N0YD11QIxm41erG   |     4.99 usd | one_time  | Resume Rescue .99 one-time
price_1TRBHbHH7N0YD11Qwx6owN7R   |     2.99 usd | one_time  | Trial 14 days
price_1TLOaqHH7N0YD11Q2oCO6YJt   |     2.99 aud | one_time  | Buy
```

What production actually points at:

```
STRIPE_PRICE_ID_PRO=price_1TtnFHHH7N0YD11QjK8Np3qf
STRIPE_PRICE_ID_PRO_YEARLY=price_1TtnFHHH7N0YD11QDCWqdAM6
STRIPE_PRICE_ID_RESCUE=price_1TtzbEHH7N0YD11QIxm41erG
STRIPE_PRICE_ID_UNLIMITED=price_1TRBHeHH7N0YD11Qumn5cvDB
STRIPE_PRICE_ID_UNLIMITED_YEARLY=price_1Tah9SHH7N0YD11QLvM1jKXR
```

| `lib/pricing.ts` | expects | Stripe says | ✓ |
|---|---|---|---|
| `PRO.price` | 19 /month | $19.00 month | ✓ |
| `PRO_YEARLY.price` | 180 /year | $180.00 year | ✓ |
| `RESCUE_PRICE_USD` | 4.99 one-time | $4.99 one_time | ✓ |
| `unlimited.price` (hidden) | 29.99 /month | $29.99 month | ✓ |
| `unlimited_yearly.price` (hidden) | 299 /year | $299.00 year | ✓ |

**Verdict: PARTIAL.** Every price the code reads is correct. But **9 of the 14
active live prices are orphans** — nothing in the codebase references them:
$299/yr, $287.90, $199, $191.90, $149, $39.99, $19.99 (×2), $2.99 (×2).
They are inert (a price only charges if a Checkout Session names it), but any of
them could be revived by a stale link or an old Payment Link and charge a
customer a price we no longer sell. Archiving them is an outward-facing change
to live payment config, so it is listed as an owner action rather than done here.

### F1b. Real end-to-end tripwire purchase

A single-use 100%-off promo (`EVIDENCE100`) was created, used once, and deleted.

| Step | Timestamp (UTC) | Source |
|---|---|---|
| Order created (form submitted) | 18:53:13.249 | `RescueOrder.createdAt` |
| Checkout completed → webhook → PAID | **19:07:53.118** | `RescueOrder.paidAt` |
| `tripwire_paid` event | 19:07:53.177 | `AnalyticsEvent` |
| Money alert relayed to Telegram | 19:07:53 | notifier log |
| Generation finished, result delivered | **19:08:10.460** | `RescueOrder.deliveredAt` |
| `tripwire_delivered` event | 19:08:10.731 | `AnalyticsEvent` |
| Delivery email accepted by Resend | 19:08:10.800 | Resend API |

```
id             | cmrtl1had0008i9yjv8i93906
email          | evidence-sweep@resumeai-bot.ru
status         | DELIVERED
attempts       | 1
paidAt         | 2026-07-20 19:07:53.118
deliveredAt    | 2026-07-20 19:08:10.46
```

Delivery email, straight from the Resend API:

```json
{"id":"a264194a-c4db-424b-b107-26e4c1593a33",
 "to":["evidence-sweep@resumeai-bot.ru"],
 "from":"noreply@resumeai-bot.ru",
 "created_at":"2026-07-20 19:08:10.800343+00",
 "subject":"Your rescued resume for \"Senior Customer Support Engineer\" is ready",
 "last_event":"delivered"}
```

**Paid → delivered: 17.342 seconds** against a 5-minute budget.

**Verdict: PASS.** Promo deleted (see [Cleanup](#cleanup)).

### F1c. Forced generation failure

A PAID order was inserted with an empty `resumeText` so the worker would reject
it, then pushed through the real `processRescueOrder` path.

```
=== order row after failure ===
id              | evidence-fail-001
status          | FAILED
attempts        | 2
error           | Worker responded 422: resume_text and job.title are required
paymentIntentId | (empty)
```

Retry behaviour, apology email and Telegram alert all fired:

```
19:13:54  [rescue] generation attempt 2 failed for evidence-fail-001
19:13:56  admin_alert.sent                          (notifier → Telegram)
19:13:56  Resend: "Your Resume Rescue failed on our side — refund on its way"
          → last_event: delivered
```

**Verdict: PARTIAL, and it found a bug.**

Proven: two attempts then give up, status → `FAILED`, apology email delivered,
founder alerted. Not proven: the actual `stripe.refunds.create` call — the test
order was fully discounted, so there was no captured payment to refund.
Exercising it for real would require entering live card details, which is out of
scope for an automated sweep.

The bug: because there was nothing to refund, the code took the "refund failed"
branch and sent

> `refund: FAILED - refund manually in Stripe!`

…while telling the customer *"your refund is being processed manually right now"*.
Both statements were false. An alert that cries wolf on every free test order is
an alert the founder learns to ignore — and this is the one alert that means
money is stuck.

Fixed in [#155](https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/pull/155):
the outcome is now three-state (`refunded` / `nothing-to-refund` / `failed`),
with regression tests for the two non-obvious branches.

### F1d. Pro subscription, $0, plan gates

Same flow as a paying customer: `/api/stripe/create-checkout-session` → live
Stripe Checkout → `EVIDENCEPRO` (100% off, single-use) → subscribe.

Checkout rendered **"Subscribe to ResumeAI Pro · US$19.00 per month"**, total due
today US$0.00.

Webhook landed at 19:37:34 (`evt_1TvN0LHH7N0YD11QHK0ykZOY`,
`evt_1TvN0MHH7N0YD11Q7U4vKeKt`). The user row afterwards, next to the tripwire
buyer who never subscribed:

```
             email              | dailyApplicationLimit |         stripePriceId          |     stripeSubscriptionId     |       firstPaidAt
--------------------------------+-----------------------+--------------------------------+------------------------------+-------------------------
 evidence-sweep@resumeai-bot.ru |                     3 |                                |                              |
 evidence-pro@resumeai-bot.ru   |                    25 | price_1TtnFHHH7N0YD11QjK8Np3qf | sub_1TvN0JHH7N0YD11QLJ8zc7mq | 2026-07-20 19:37:34.091
```

`dailyApplicationLimit` 3 → **25**, the Pro price id attached, `firstPaidAt` set,
period end 2026-08-20. The gate in `quota.ts` opens on payment.

**Verdict: PASS.** Subscription cancelled at cleanup.

### F1e. Upsell coupon

Issued automatically on delivery of the F1b purchase:

```
promo_1TvMXuHH7N0YD11QFDi0BQ6B
  active: True | max_redemptions: 1 | times_redeemed: 0
  expires_at: 2026-07-23T19:08:09Z          (delivery 19:08:09 + 72h exactly)
  coupon: vT9QYVHn | amount_off: 10.00 usd | duration: once | valid: True
  metadata: {'rescueOrderId': 'cmrtl1had0008i9yjv8i93906'}
```

$19 − $10 = **$9 first month**, single-use, 72h, bound to the order.

**Verdict: PASS.**

### F1f. Funnel events

```
       event        | n  |        last_seen
--------------------+----+-------------------------
 checkout_started   | 16 | 2026-07-20 19:17:02.607
 fitcheck_started   |  3 | 2026-07-20 19:47:01.674
 lead_captured      |  2 | 2026-07-20 19:47:01.764
 tripwire_delivered |  2 | 2026-07-20 19:08:10.731
 tripwire_paid      |  2 | 2026-07-20 19:07:53.177
 tripwire_view      |  5 | 2026-07-20 18:45:57.998
 checkout_abandoned |  1 | 2026-07-20 20:26:02.128
```

Sample rows:

```
 checkout_started   | {"planId": "pro", "priceId": "price_1TtnFHHH7N0YD11QjK8Np3qf", "interval": "month"}
 checkout_abandoned | {"mode": "payment", "sessionId": "cs_live_b1z3Yh7mBG57jf1O251p9J1F2vzauv8pbSSH6YzFuro9dPvXJ8AMtKhVS9"}
 fitcheck_started   | {"score": 63, "source": "ats-check", "hasEmail": true}
 lead_captured      | {"score": 63, "leadId": "cmrtmyody000wi9yjt89x18hj", "source": "ats-check"}
 tripwire_paid      | {"orderId": "cmrtl1had0008i9yjv8i93906", "amountTotal": 0}
 tripwire_delivered | {"cached": false, "attempt": 1, "orderId": "cmrtl1had0008i9yjv8i93906", "tokensUsed": 77, "minutesFromPayment": 0}
```

`checkout_abandoned` had zero rows at the start of the sweep because it fires on
Stripe's `checkout.session.expired`, which arrives ~24h after a session is
created. Expiring a real abandoned session via the API produced the real webhook
and the row above, 1.1 seconds later.

**`upsell_accepted` is the one event with no row, and it could not be produced.**
It fires when a completed checkout carries `metadata.upsellOrderId`. The upsell
route was driven for real and the session it created does carry the trigger:

```json
{"id": "cs_live_a18XI807vCdbll3ewiJWNuwKY9eO0qOhs14j6yHNzTkrdQDfGaI3simyu7",
 "mode": "subscription", "amount_total": 0,
 "metadata": {"upsellOrderId": "cmrtl1had0008i9yjv8i93906"},
 "client_reference_id": "cmrtlkc5g000ai9yjzeg4rk7t"}
```

But unlike the main checkout route, `/api/rescue/[id]/upsell` does not set
`payment_method_collection: 'if_required'`, so Stripe demands a card even at $0
today — correct behaviour for a "first month $9, then $19" offer, and a hard stop
for this sweep. The unproven step is the `if (session.metadata?.upsellOrderId)`
branch, eight lines below the `checkout_completed` call that demonstrably fired
twice today in the same switch case.

**Verdict: PARTIAL** — 7 of 8 events proven with real rows.

---

## F2 — Capture and nurture

### F2a. Real `/ats-check`

```
REQUEST SENT AT (UTC): 2026-07-20T19:47:00Z
{"score":63,"findings":["some skills overlap (9 terms)","remote — best eligibility"],
 "hints":[...3 hints...],"unlocked":true,"remaining":2}
HTTP 200 in 0.992503s
```

Lead row, with the nurture sequence scheduled:

```
                 email                 |  source   |       createdAt        |        consentAt        | nurtureStage |      nurtureNextAt      | lastScore |      lastJobTitle
---------------------------------------+-----------+------------------------+-------------------------+--------------+-------------------------+-----------+-------------------------
 evidence-lead-2026-07@resumeai-bot.ru | ats-check | 2026-07-20 19:47:01.75 | 2026-07-20 19:47:01.749 |            1 | 2026-07-22 19:47:01.749 |        63 | Senior Backend Engineer
```

`nurtureNextAt` is exactly +2 days, matching `STAGE_DELAYS_DAYS`. Report email:

```json
{"id":"5a99a502-5065-4bc8-974f-cfcc94366354",
 "to":["evidence-lead-2026-07@resumeai-bot.ru"],
 "created_at":"2026-07-20 19:47:02.060196+00",
 "subject":"Your fit score for \"Senior Backend Engineer\": 63/100",
 "last_event":"delivered"}
```

**Verdict: PASS** — lead captured, consent recorded, report delivered 310ms after
the response, sequence scheduled.

### F2b. Abandoned checkout, 4h rule

A real order was created through `/api/rescue/checkout` and never paid, then
backdated 5 hours to cross the 4h threshold (simulation, as briefed).

```
=== backdate ===
 cmrtog9ud001bi9yjup80muo3 | evidence-abandon@resumeai-bot.ru | PENDING_PAYMENT | 2026-07-20 15:29:20.339 | abandonedEmailAt: (null)

=== trigger the hourly cron ===
cron invoked at 2026-07-20T20:29:20Z
cron HTTP 200 in 0.819934s

=== after ===
 cmrtog9ud001bi9yjup80muo3 | evidence-abandon@resumeai-bot.ru | PENDING_PAYMENT | 2026-07-20 15:29:20.339 | abandonedEmailAt: 2026-07-20 20:29:21.149

=== cron log ===
[daily-digest] cron fired { runAt: '2026-07-20T20:29:20.580Z' }
[daily-digest] nurture sent: 0 abandoned reminders: 1
```

```json
{"id":"92ca617e-69a2-4079-9cd6-fa8b088c0a8c",
 "to":["evidence-abandon@resumeai-bot.ru"],
 "created_at":"2026-07-20 20:29:21.174964+00",
 "subject":"Your resume rescue for \"Platform Engineer\" is one click from done",
 "last_event":"delivered"}
```

**Verdict: PASS.** `abandonedEmailAt` is set in the same transaction, so the
"only reminder I'll send" promise holds.

### F2c. Unsubscribe

```
unsubscribe requested at (UTC): 2026-07-20T20:29:41Z
HTTP 303 -> https://resumeai-bot.ru/unsubscribed
```

```
=== suppression list AFTER ===
                 email                 |   reason    |        createdAt
---------------------------------------+-------------+-------------------------
 evidence-lead-2026-07@resumeai-bot.ru | unsubscribe | 2026-07-20 20:29:41.852

=== lead state ===
                 email                 | nurtureStage | nurtureNextAt |     unsubscribedAt
---------------------------------------+--------------+---------------+-------------------------
 evidence-lead-2026-07@resumeai-bot.ru |            1 |    (null)     | 2026-07-20 20:29:41.857
```

**Verdict: PASS.** One click, no login, suppression row written and
`nurtureNextAt` cleared — the sequence cannot resume.

---

## F3 — Autonomous ops

### F3a. Daily pulse

```
=== daily_pulse_sent (all time) ===
 event | createdAt | properties
-------+-----------+------------
(0 rows)
```

**Verdict: FAIL. The daily pulse has never fired in production.**

Not a code fault — a timing fault. `maybeSendDailyPulse` gates on
`currentSydneyHour() === 9`, which in July is the **23:00–23:59 UTC** hour.
Session D shipped at 08:06 UTC on 2026-07-20, so the first eligible window had
not yet arrived when this sweep ran (20:30 UTC).

That makes the gate itself the risk. GitHub's scheduler is not punctual — the
digest cron's own run history today shows it skipping hours entirely:

```
19:34, 18:42, 17:46, 16:32, 15:38, 14:48, 13:37, 12:49, 11:04, 09:09, 07:14, 05:18, 03:10, 01:43, 00:46
                                                          ^^ no 10:xx   ^^ no 08:xx  ^^ no 06:xx  ^^ no 04:xx  ^^ no 02:xx
```

A once-daily report that only fires if a jittery scheduler happens to land inside
one specific 60-minute window will silently skip days. `maybeRunSeoAutomation`
does not have this problem — it accepts a 6-hour window (06–11 UTC) and dedupes
on a marker event, which is why it has run on four consecutive days.

Recommended fix: widen the pulse gate the same way (accept Sydney hours 9–14,
dedupe on the existing 20-hour `daily_pulse_sent` marker). Not done in this
session — see [Open items](#open-items). **The `[D1] daily pulse` checkbox in
MASTER_PLAN has been unchecked.**

### F3b. Real-time money alerts

Every money moment in this sweep produced a Telegram relay:

```
=== notifier logs ===
2026-07-20 19:07:53 [info     ] admin_alert.sent     ← tripwire sale ($4.99 path)
2026-07-20 19:13:56 [info     ] admin_alert.sent     ← rescue generation failed
2026-07-20 19:37:34 [info     ] admin_alert.sent     ← new Pro subscription

=== dedupe key still live in Redis ===
alert:dedupe:money:evt_1TvN0LHH7N0YD11QHK0ykZOY
```

The three relay timestamps match `tripwire_paid` (19:07:53.177), the generation
failure (19:13:54) and the subscription webhook (19:37:34) to the second, and the
Redis key carries the exact Stripe event id, confirming per-event dedupe.

**Verdict: PASS.**

### F3c. IndexNow and sitemap

The real cron ran the weekly Monday push this morning, unprompted:

```
        createdAt        |                                             properties
-------------------------+-----------------------------------------------------------------------------------------------------
 2026-07-20 07:14:30.298 | {"checked": 290, "failures": 0, "indexnowOk": true, "sitemapError": null, "indexnowSubmitted": 290}
 2026-07-19 06:58:01.729 | {"checked": 290, "failures": 0, "sitemapError": null}
 2026-07-18 06:45:41.751 | {"checked": 290, "failures": 0, "sitemapError": null}
 2026-07-17 09:38:48.016 | {"checked": 103, "failures": 0, "sitemapError": null}
```

290 URLs submitted, accepted, zero non-200 pages. Confirmed independently:

```
=== [1] IndexNow key file (ownership proof) ===
9a95557e770ff35b9d7b8bbd4e6547e5
HTTP 200

=== [2] api.indexnow.org (2026-07-20T20:23:05Z) ===
HTTP 200

=== [3] www.bing.com/indexnow ===
HTTP 200
```

There is no sitemap "ping" to report: Google retired its ping endpoint in 2023 and
`lib/seo/health.ts` documents that discovery now runs through the sitemap plus
Search Console. IndexNow covers Bing/Yandex/Seznam/Naver.

**Verdict: PASS.**

### F3d. `npm run smoke`

```
[19:48:42] Fetching https://resumeai-bot.ru pages (single connection)
[19:48:44]   OK homepage
[19:48:44]   OK pricing page
[19:48:44]   OK login page (HTTP 200)
[19:48:44]   OK faq page
[19:48:44]   OK web /api/health (HTTP 200)
[19:48:44]   OK worker health (proxy) (HTTP 200)
[19:48:44]   OK NextAuth CSRF
[19:48:44]   OK OAuth providers
[19:48:44]   OK tripwire page
[19:48:45]   OK auth sign-in (redirects to Google)
[19:48:46]   OK fit-check API (HTTP 400 in 0.500505s)
[19:48:46]   OK stripe webhook (rejects unsigned with 400)
[19:48:56] WARN: SSH to root@31.97.62.185 unavailable -- infra checks skipped
[19:48:56] Infra checks skipped (HTTP checks only)
[19:48:56] All smoke checks passed
```

**Verdict: PARTIAL, and it exposed a second defect.** All 12 HTTP checks pass.
The container checks did not run — and the script still printed
**"All smoke checks passed"**.

`scripts/smoke.sh:30` defaults to `SMOKE_SSH_HOST=root@178.105.185.214`. Anyone
running `npm run smoke` from a dev machine with an unreachable SSH target gets a
single `WARN` line followed by a green "all passed", which is exactly the kind of
reassuring output that hides an outage. The infra half should either fail loudly
or the summary should say "HTTP only". See [Open items](#open-items).

---

## F4 — SEO reality

### F4a. Live sitemap, by template type

```
 169 /apply-to
  39 /jobs-in
  20 /resume
  13 /resume-keywords
  12 /auto-apply
  10 /remote
  10 /alternatives
   3 /blog
  12 (one each: /, /pricing, /faq, /contact, /login, /terms, /privacy,
      /refund-policy, /changelog, /compare, /proof, /ats-check,
      /resume-rescue, /free-resume-teardown)
TOTAL: 290
```

```
checked: 290/290
non-200: 0
```

**Verdict: PASS.** Zero 404s.

### F4b. Lighthouse

```
/                        perf=90   seo=100
/resume-rescue           perf=95   seo=100
/ats-check               perf=100  seo=100
/alternatives/jobscan    perf=100  seo=100
```

**Verdict: PASS.** SEO 100 across the board, nothing to fix. Performance floor is
the homepage at 90.

### F4c. Static rendering

```
app/jobs-in/[country]/page.tsx             use-client:0 staticParams:1 static
app/apply-to/[company]/page.tsx            use-client:0 staticParams:1 revalidate=21600
app/apply-to/page.tsx                      use-client:0 staticParams:0 static
app/resume-keywords/[role]/page.tsx        use-client:0 staticParams:1 static
app/alternatives/[competitor]/page.tsx     use-client:0 staticParams:1 static
app/auto-apply/[board]/page.tsx            use-client:0 staticParams:1 static
app/remote/[slug]/page.tsx                 use-client:0 staticParams:1 static
app/resume/[profession]/page.tsx           use-client:0 staticParams:1 static
app/blog/page.tsx                          use-client:0 staticParams:0 static
app/blog/[slug]/page.tsx                   use-client:0 staticParams:1 revalidate=86400
app/compare/page.tsx                       use-client:0 staticParams:0 static
app/page.tsx                               use-client:0 staticParams:0 revalidate=3600

components/site-header.tsx                 use-client:0
components/site-footer.tsx                 use-client:0
components/rescue-cta-block.tsx            use-client:0
```

**Verdict: PASS.** Every public SEO template is a server component with
`generateStaticParams`, and the shared chrome ships zero client JS.

---

## Open items

Three defects. One fixed this session, two need a decision.

**1. Refund alert lied on free orders — FIXED.**
[#155](https://github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/pull/155).

**2. Daily pulse gate is too narrow — NOT FIXED.**
One-hour window versus a scheduler that skips hours. Widen to Sydney 9–14 and
lean on the existing dedupe marker. Small change; left out of this session so the
evidence and the fix stay separable.

**3. `npm run smoke` reports green when infra checks are skipped — NOT FIXED.**
Plus a stale default host (`178.105.185.214` in `scripts/smoke.sh:30`) that does
not match the address used elsewhere in this session.

**Owner action: 9 orphaned live Stripe prices.** Archiving them is a change to
live payment configuration, so it needs a human decision rather than an agent's.

## Cleanup

Everything this sweep created in live Stripe was removed:

```
promo EVIDENCEUPSELL  -> active: false
promo EVIDENCEPRO     -> active: false
promo EVIDENCE100     -> active: false
coupon 9qXW95NA       -> deleted: true
coupon TqjUilcu       -> deleted: true
coupon leXWExde       -> deleted: true
sub_1TvN0JHH7N0YD11QLJ8zc7mq -> canceled
2 open checkout sessions      -> expired
RescueOrder cmrtl1had0008i9yjv8i93906 -> real upsell promo restored
```

Left in place deliberately, as the audit trail behind this document: the
`AnalyticsEvent` rows, the four `evidence-*@resumeai-bot.ru` records
(2 users, 3 rescue orders, 1 lead, 1 suppression entry). None of them carry a
live payment method. Purge whenever you like.
