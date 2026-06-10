# Journey Friction Log — would a skeptical visitor trust us with $19.99?

**Date:** 2026-06-10 · Prompt 11 §3. Ranked by conversion impact. 🔧 = fixed this session.

## Fixed (cheap, this session)
| Friction | Fix |
|----------|-----|
| 🔧 Login said "Welcome back" — a first-time visitor isn't "back"; reads like they need an existing account | "Sign in or create your account" + "Continuing with Google/GitHub creates your account instantly" |
| 🔧 Sign-in error shown in alarming red with a terse message, no reassurance | Amber, reassuring "usually works on the second try", providers right there for one-click retry |
| 🔧 A flaked sign-in could read as a dead end | Retry path is explicit + the friendly copy never exposes a raw error code |

## Ranked backlog (not yet fixed)
| # | Friction | Impact | Effort | Notes |
|---|----------|--------|--------|-------|
| 1 | No social proof / outcome numbers on landing for a skeptical buyer (real-outcomes band is gated until ≥200 apps) | High | M | Add honest "applications submitted to date" counter once data is clean post-2026-06-10; no fake testimonials (FTC) |
| 2 | Activation: clicks-to-first-campaign not measured; onboarding may exceed 5 clicks (signup → resume → campaign) | High | M | Add a guided "create your first campaign" CTA on the empty dashboard; measure |
| 3 | Pricing: no annual-vs-monthly savings emphasis / "most popular" anchor beyond defaults | Med | S | Verify the toggle highlights yearly savings clearly |
| 4 | Empty states: dashboard before first campaign / inbox before first reply — confirm they explain "what happens next" rather than showing 0s | Med | S | Authed review needed |
| 5 | Loading states during resume generation (can take ~15–25s) — ensure a progress indicator, not a frozen button | Med | S | Authed review needed |
| 6 | Trust signals: no visible "secure payments by Stripe", refund guarantee is on pricing but not at checkout entry | Med | S | Add Stripe/secure badge near the subscribe button |
| 7 | Error states when worker is down — confirm graceful copy, not a white screen | Med | S | Manual drill (stop worker container) |
| 8 | Mobile: verified no horizontal overflow on landing; audit dashboard/pricing on mobile too | Low | S | Extend mobile e2e to dashboard/pricing |

## Method
Public pages walked headless against prod (`PLAYWRIGHT_BASE_URL=https://resumeai-bot.ru`); authed steps require the test-auth harness (see journey-audit TODO). No real Stripe charges; Stripe test mode for local checkout.
