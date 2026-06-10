# ResumeAI — Subsystem Index

The 9 SaaS subsystems → where they live in code → the one metric that owns each →
where that metric is visible today. Source of truth is the code; update on structural change.

| # | Subsystem | Primary code paths | Owning metric | Visible today |
|---|-----------|--------------------|---------------|---------------|
| 1 | **Product** (auto-apply + resume engine) | `app/api/cron/run-campaigns/route.ts` · `worker/worker/autoapply/careerops.py` · `worker/worker/scrapers/*` · `worker/worker/ai/*` · `lib/eligibility.ts` | Applications SUBMITTED · interview rate | `/admin/pmf` (apps submitted, interview rate); `scripts/funnel_report.ts` |
| 2 | **Infra** (single VPS, Compose, CI/CD) | `docker-compose.yml` · `Caddyfile` · `.github/workflows/deploy.yml` · `run-campaigns.yml` · `worker/worker/main.py` · `lib/redis.ts` | Uptime · container memory · deploy success | `uptime-kuma` container · `gh run list` |
| 3 | **Acquisition** (SEO + landing + leads) | `app/page.tsx` · `app/{jobs-in,auto-apply,resume,alternatives,remote}/*` · `lib/seo-data.json` · `app/api/lead` · `app/sitemap.ts` | New signups | `/admin/pmf` → Funnel (signups) |
| 4 | **Sales** (pricing → checkout) | `components/pricing-cards.tsx` · `app/pricing/page.tsx` · `app/api/stripe/create-checkout-session/route.ts` · `lib/stripe.ts` · `lib/pricing.ts` | Free → paid conversion | `/admin/pmf` (Today: conversions) |
| 5 | **Onboarding** (activation: signup→resume→campaign) | `app/(auth)/login` · `lib/auth.ts` · `app/dashboard/resumes/*` · `app/dashboard` (campaign create) · `app/api/campaigns` | % of signups creating a resume / campaign | `/admin/pmf` → Funnel (created resume / campaign) |
| 6 | **Retention** (deliver value, keep users) | `app/dashboard/*` · `app/dashboard/inbox` · `app/api/inbox/inbound/route.ts` · `lib/inbox/classify.ts` · `notifier/` · `lib/notifications.ts` | D30/D90 retention · human replies | `/admin/pmf` (cohort retention; Funnel human replies) |
| 7 | **Monetization** (tiers, quota, limits) | `lib/quota.ts` · `lib/pricing.ts` · `lib/subscription.ts` · webhook plan-sync | MRR · ARPU | `/admin/pmf` (MRR, net new MRR) |
| 8 | **Finance** (billing ops, refunds, invoices) | `app/api/webhooks/stripe/route.ts` · `app/api/billing/refund` · `lib/billing/*` · `lib/invoices.ts` · `app/dashboard/billing` | Refund rate · churned MRR | `/admin/pmf` (refunds + refund rate) · Stripe dashboard |
| 9 | **Legal** (compliance, consent, deletion) | `app/{terms,privacy,refund-policy,contact}` · `app/api/teardown` · `lib/compliance.ts` · `Consent` model | Data-deletion requests honored · consent captured | Manual (email/Stripe) · `teardown` API; no dashboard tile yet |

## Gaps in metric visibility (audit 2026-06-10)
- Subsystem **9 (Legal)** has no dashboard tile — deletion/consent tracked only manually.
- Subsystem **3 (Acquisition)** has no traffic→signup source attribution (no PostHog/analytics events confirmed in code).
- All revenue/funnel metrics live only on `/admin/pmf` (admin-gated) + `scripts/funnel_report.ts`; no external BI.
