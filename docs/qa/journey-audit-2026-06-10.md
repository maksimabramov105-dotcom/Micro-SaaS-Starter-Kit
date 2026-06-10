# End-to-End Journey Audit — landing → sign-in → pay

**Date:** 2026-06-10 · **Prompt 11** · acting as a new paying customer of https://resumeai-bot.ru

Legend: ✅ pass · ⚠️ partial / needs authed harness · 🔧 fixed this session · 📝 manual/test-mode

## P0 — sign-in flake

**Investigation (the documented suspects, in order):**
- `NEXTAUTH_URL` = `https://resumeai-bot.ru` (apex) ✅ correct.
- www→apex: Caddy already `redir https://resumeai-bot.ru{uri} permanent` — keeps OAuth state/PKCE on one origin (a prior fix). ✅
- OAuth callback allowlist / session strategy: JWT sessions, `allowDangerousEmailAccountLinking: true` on both providers (auto-links same-email accounts on retry). ✅
- Cookies behind proxy: NextAuth derived secure cookies from the https `NEXTAUTH_URL`, but it wasn't pinned. **🔧 set `useSecureCookies: true` in prod** so the state/PKCE/CSRF cookies always get correct Secure + `__Host-`/`__Secure-` treatment behind the Caddy TLS proxy.
- **Telemetry gap (the real blocker to "finding" it):** zero auth errors were ever captured — NextAuth's logger output wasn't wired. **🔧 added a `logger` to `authOptions`** that logs `[next-auth][error] <code> <metadata>` so the next occurrence is diagnosable (which code: OAuthCallback vs OAuthCreateAccount vs Callback).
- First-user Prisma race (unique Account): suspected for brand-new users; now observable via the logger. Documented to monitor.

**User-facing fix (deterministic, shipped):** the error state on `/login` now shows a friendly, reassuring message ("This usually works on the second try — click your provider again below") with the providers right there as a one-click retry, and **never** renders a raw NextAuth code. Regression test: `e2e/auth-signin-retry.spec.ts`.

## Journey checklist

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1 | Landing loads, real CTA, clean console, mobile OK | ✅ | `journey.spec.ts` passes against prod (Lighthouse perf 99 from prior audit) |
| 2 | Sign-up → dashboard with next step | ⚠️ 📝 | Auth gate verified (`/dashboard`→`/login`); full OAuth signup needs the test-auth harness (see TODO). Clicks-to-first-campaign not yet measured |
| 3 | Resume creation → preview, PDF, contact propagated | 📝 | Authed; PDF route + contact propagation fixed earlier (#50). Manual/test-mode |
| 4 | Campaign creation → eligibility saved, human-readable validation | 📝 | Authed; eligibility profile drives targeting_v2 |
| 5 | Pricing → checkout (test mode) → webhook → quota → portal/cancel | ⚠️ 📝 | Pricing tiers + guarantee render ✅; logged-out subscribe routes to `/login` (no dead end) ✅; authed Stripe-test checkout = test-mode manual |
| 6 | Inbox: inbound webhook → classified → Telegram | 📝 | Handler verified in code; notifier `interview_reply` fires. Simulate via Resend webhook manual |
| 7 | Teardown / GDPR deletion | 📝 | `/free-resume-teardown` public; `app/api/teardown` removes data |
| 8 | Error states (worker down) → graceful | 📝 | Apply path degrades to FAILED/skip, not white screen; manual drill |

`journey.spec.ts` (chromium) covers the deterministic public steps (1, 2-gate, 5a/5b, legal) and runs in CI against the local compose app — **gates deploys** (added to `ci.yml` → `e2e-journey`).

## UX friction fixed this session (<30 min)
- 🔧 Login heading was "Welcome back" — confusing for first-time sign-ups (it's the only auth entry). Now "Sign in or create your account" + "Continuing with Google/GitHub creates your account instantly."
- 🔧 Sign-in error box restyled from alarming red to amber with reassuring retry copy.

## TODO (larger than this session)
| Item | Effort | Why |
|------|--------|-----|
| Test-auth harness (seed a NextAuth JWT/session cookie in CI) to cover authed steps 3–6 in `journey.spec.ts` | ~4h | Full journey gating incl. resume/campaign/checkout/inbox |
| Measure clicks-to-first-campaign + reduce if >5 | ~2h | Activation funnel (Prompt 09 funnel row tracks resume/campaign rates) |
| Simulated Resend inbound + Stripe-test webhook e2e | ~3h | Steps 5–6 automated |
| Reproduce the OAuth flake with real provider creds (needs a test Google/GitHub account) | — | Confirm root cause now that the logger captures it |

See `docs/qa/journey-friction-2026-06-10.md` for the ranked friction list.
