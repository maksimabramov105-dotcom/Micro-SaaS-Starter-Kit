# Investor metrics snapshot — /admin/pmf

**Generated:** 2026-06-15 · **Window:** last 30 days · **Source:** production Postgres + Stripe API

This is the exported figure set that the admin-gated `/admin/pmf` dashboard renders
live and that `scripts/funnel_report.ts --json` prints. Captured here as the QA
artifact (the dashboard is admin-auth + DB-backed, so it renders only for a
logged-in admin; these are the same numbers).

## Revenue (Stripe-synced · MRR monthly-normalized)

| Metric | Value |
|---|---|
| MRR | **$0.00** |
| ARR | $0.00 |
| Paying customers | 0 |
| Blended ARPU | $0.00 |
| Free → paid conversion | 0% (0 of 4 signups have ever paid) |
| Churned MRR (30d) | $0.00 |

Pre-launch: the only accounts are test/dogfood users, so there is no revenue yet.
The dashboard + script are wired to show real MRR/ARR/ARPU the moment paying
customers exist.

## Funnel (last 30 days)

| Stage | Count |
|---|---|
| Signups | 3 |
| Applications submitted | 239 |
| Human replies (interview · question · rejection) | 23 |
| Interview-request replies | 0 |
| Apps in INTERVIEW status | 0 |
| Active paying subscribers | 0 |

239 real submissions, 23 human replies, **0 interviews** — the value gap the
Interview-Conversion Engine (prompt 10) targets. Now measurable per-stage.

## Stripe reconciliation (Stripe is the source of truth for billing)

| | MRR |
|---|---|
| DB-derived (active subs × monthly-normalized plan price) | $0.00 |
| Stripe API (`subscriptions.list status=active`) | $0.00 |
| Active subscriptions in Stripe | 0 |
| **Reconciles (±$1)** | **YES** |

`scripts/funnel_report.ts` performs this same cross-check automatically
(`reconciliation.reconciles`) whenever `STRIPE_SECRET_KEY` is present, so MRR is
verified against Stripe on every run — not just trusted from our DB.

## How to reproduce

```bash
# Full investor export as JSON (funnel + revenue + reconciliation + weekly trends):
npx tsx scripts/funnel_report.ts 30 --json

# Human-readable table:
npx tsx scripts/funnel_report.ts 30
```

The live dashboard is at `/admin/pmf` (visible to emails in `ADMIN_EMAILS`).
Week-over-week trend sparklines (signups, conversions, submitted, interviews,
net-new MRR) render at the top of that page.
