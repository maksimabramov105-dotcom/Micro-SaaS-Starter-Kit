# Recruiter replies (inbound email) — status & findings

> **Status (2026-05-30, updated):** The inbound reply pipeline is **fully
> configured and verified working end-to-end.** The reason there are no
> recruiter replies is upstream — see "Real finding" below.

## Pipeline is healthy (verified)

DNS is now managed by **Cloudflare**; sending + receiving run through **Resend**.

| Component | State |
|-----------|-------|
| Resend domain `resumeai-bot.ru` | verified, `sending` + `receiving` enabled |
| MX (root) | `inbound-smtp.us-east-1.amazonaws.com` (Resend inbound) prio 9, reg.ru 10/20 fallback |
| Resend webhook | enabled → `https://resumeai-bot.ru/api/inbox/inbound`, subscribed to `email.received` |
| Signing secret | Resend webhook secret == VPS `RESEND_WEBHOOK_SECRET` ✓ |
| Handler | `app/api/inbox/inbound/route.ts` — verified live: signed POST → 200 → `InboxMessage` row created |

A genuine signed `email.received` event was POSTed to the live endpoint on
2026-05-30; it returned `200 {ok:true}` and created an `InboxMessage` row
(then deleted). So any real recruiter reply **will** be captured and
auto-classified (`INTERVIEW_REQUEST` → application set to INTERVIEW;
`REJECTION` → REJECTED).

## Real finding: why there are still 0 replies

All inbound mail Resend has ever received (6 emails) were **Tolt verification
codes** — zero from any employer/ATS.

More importantly, **159 "SUBMITTED" applications to major Greenhouse companies
(Cloudflare, Figma, Robinhood, Twilio, Checkr…) produced zero ATS confirmation
emails.** Greenhouse normally emails the candidate a confirmation on a real
submission. Zero confirmations across 159 submissions strongly suggests the
CareerOps worker is marking applications `SUBMITTED` without the Greenhouse
form actually completing — Greenhouse typically requires a **resume file
upload** and **work-authorization / EEO questions** that a name+email fill
won't satisfy, so the server-side submit is likely rejected while the worker
reports success.

### Recommended next step (separate from replies)
1. Run one **live test application** to a known Greenhouse job with a real
   inbox handle and watch for the confirmation email in `InboxMessage`.
2. If none arrives, audit the CareerOps worker's submit path
   (`worker/.../autoapply/careerops`) — confirm it uploads a resume file,
   answers required questions, and only reports `submitted` after Greenhouse
   returns its post-submit confirmation page, not just after clicking submit.

## Minor housekeeping (optional)
- The reg.ru fallback MX records (prio 10/20) point at a mail host that may be
  defunct since the Cloudflare move. They only receive mail if Resend's inbound
  endpoint is down (rare), but removing them guarantees all mail reaches Resend.
- Telegram notifications: all users have empty `telegramUsername`
  (notifier logs `event.no_chat`), so submit/interview notifications are
  dropped. Onboarding gap, not a bug — users must link Telegram via the bot.
