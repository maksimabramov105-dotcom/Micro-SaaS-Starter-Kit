# Journey Friction Log — 2026-06-15 (re-audit)

Prompt 11 re-run. Focus: confirm the sign-in flake is dead and the paid journey
holds end-to-end. `🔧` = fixed this session.

## Sign-in flake (P0) — VERIFIED FIXED

| Check | Result |
|---|---|
| Root cause (OAuthAccountNotLinked: same email, different provider) | Fixed — `allowDangerousEmailAccountLinking: true` on both providers links on first attempt (`lib/auth.ts`) |
| Raw NextAuth error reachable? | **No.** `pages.error: '/login'` maps every code to a friendly message; live `/login?error=OAuthCallback` HTML contains the raw code **0 times** |
| Cookie-loss-on-redirect suspect (www/http) | Ruled out — `NEXTAUTH_URL=https://resumeai-bot.ru` (canonical); www→non-www (301) and http→https (308) both redirect *before* OAuth, callbacks advertise the canonical host, JWT sessions, `useSecureCookies` from the proxy scheme |
| Friendly retry UI | In place — amber, "usually works on the second try", both providers one-click; auto-retries once on a retryable code |
| Regression test | `e2e/auth-signin-retry.spec.ts` (friendly message, no raw code, working retry, account-link copy, clean-login) — **green in CI** |

## Paid journey (Stripe test mode) — VERIFIED

Webhook handler `app/api/webhooks/stripe/route.ts`:

| Step | Behavior | OK |
|---|---|---|
| checkout.session.completed | sets `stripePriceId`, `stripeCurrentPeriodEnd`, **`dailyApplicationLimit = plan.dailyLimit` (quota up)**, `firstPaidAt` (once) | ✅ |
| customer.subscription.updated | updates price + period end + quota on plan change | ✅ |
| customer.subscription.deleted | resets to free: `stripePriceId=null`, `dailyApplicationLimit=free`, `cancelledAt` set → **downgrade at period end** | ✅ |
| End-to-end in test mode | `e2e/journey-payment-inbox.spec.ts` (pricing → checkout → webhook → plan active → quota → inbox) — **green in CI** |

CI gate: `ci.yml` `E2E journey` job runs journey + journey-authed +
journey-payment-inbox + auth-signin-retry on every push (latest main run: green).

## Fixed (cheap, this session)
| Friction | Fix |
|---|---|
| 🔧 No "secure payment" signal at the point of payment (only the guarantee line) | Added "Secured by Stripe · no card details touch our servers" with a lock icon under the subscribe button (`components/pricing-cards.tsx`) — backlog #6 |

## Ranked backlog (carried forward, not yet fixed)
| # | Friction | Impact | Effort | Notes |
|---|---|---|---|---|
| 1 | Outcome numbers on landing for skeptical buyers | High | M | `/proof` now live (239 submissions / 31 confirmed). Could surface a counter on the landing hero too. No fake testimonials (FTC). |
| 2 | Activation: clicks-to-first-campaign not measured; may exceed 5 | High | M | Add a guided "create your first campaign" CTA on the empty dashboard; instrument with the funnel events from prompt 10 |
| 3 | Pricing: annual-savings emphasis / "most popular" anchor | Med | S | Verify the monthly/yearly toggle highlights yearly savings |
| 4 | Empty states (dashboard pre-campaign, inbox pre-reply) explain "what happens next" | Med | S | Authed review |
| 5 | Loading state during resume generation (~15–25s) — progress, not a frozen button | Med | S | Authed review |
| 7 | Worker-down error state — graceful copy, not white screen | Med | S | Manual drill (stop worker container) |
| 8 | Mobile audit of dashboard/pricing (landing already clean) | Low | S | Extend mobile e2e |

## Method
Sign-in config + paid-journey webhook reviewed in code; live no-raw-error check
against prod; e2e (journey + payment + auth-retry) green in CI (Stripe test mode,
no real charges). Authed/visual steps (#4, #5, #8) still need the local
docker-compose + test-auth harness for a full walk.
