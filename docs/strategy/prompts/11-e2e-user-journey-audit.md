# Prompt 11 — End-to-End User Journey Audit (landing → sign-in → pay)

Copy everything below into Claude Code, run from `~/code/Micro-SaaS-Starter-Kit`.

---

Act as a brand-new paying customer of https://resumeai-bot.ru and audit the complete journey. Known bug: **sign-in sometimes fails on the first attempt and shows an error** — finding and fixing this is the top priority of this prompt. Use the existing Playwright e2e setup (`e2e/`); run against a local docker-compose stack where possible, and write non-destructive checks for prod (no real Stripe charges — use Stripe test mode locally).

## 1. Sign-in flake (P0)
1. Reproduce: loop the Google/GitHub OAuth sign-in flow 10× headless. Capture the exact error (NextAuth error code, callback URL, cookie state).
2. Inspect the usual suspects in order: `NEXTAUTH_URL` vs canonical domain (www vs non-www, http→https redirect by caddy), OAuth callback URL allowlist, cookie `SameSite/secure` behind the proxy (`trustHost`), clock skew, double-submit of the callback, Prisma adapter race on first-ever user creation (unique constraint on Account), session strategy.
3. Fix root cause, add an e2e regression test `e2e/auth-signin-retry.spec.ts`, and add a friendly retry UI on the error page (never show a raw NextAuth error to users).

## 2. Full journey checklist (each step = an e2e test or a documented manual check)
1. Landing loads <2s, no console errors, all CTAs lead somewhere real, mobile viewport OK.
2. Sign-up (new user) → lands in dashboard with a clear next step (onboarding into first resume/campaign — measure clicks-to-first-campaign; flag anything >5 clicks).
3. Resume creation → preview renders, PDF export works, contact data correctly propagated.
4. Campaign creation → eligibility profile saved correctly, validation errors are human-readable.
5. Pricing page → checkout (Stripe test mode) → webhook → plan active in dashboard → quota actually increases. Then: billing portal opens, cancel works, plan downgrades at period end.
6. Inbox: simulate an inbound Resend webhook → message appears classified in dashboard → Telegram notification fires.
7. Teardown/GDPR: account deletion removes user data.
8. Error states: API down (stop worker container) → user sees graceful degradation, not white screens.

## 3. UX friction notes
While walking through, record every moment of confusion in `docs/qa/journey-friction-<date>.md`: unclear copy, dead ends, missing loading states, missing empty states, anything that would make a skeptical visitor distrust us with $19.99. Fix the cheap ones (<30 min each) in this session, list the rest ranked by conversion impact.

## 4. Deliverables
- Fixed sign-in flake + regression test.
- `e2e/journey.spec.ts` covering steps 1–6 (test mode).
- `docs/qa/journey-audit-<date>.md` — pass/fail table + friction list.
- CI: make the journey spec part of `ci.yml` (against local compose) so it gates deploys.

Show me the diff summary before pushing to `main`.
