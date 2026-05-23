# Strategy Prompts — How to use them

This folder contains 9 self-contained prompts. Paste them into Claude Code one at a time, in order, at the root of the `Micro-SaaS-Starter-Kit` working tree. Each prompt instructs Claude Code to read the right docs, make surgical changes, push to GitHub, deploy to the VPS, and verify the change is live in production.

## The execution order

| Step | Prompt file | What it does | Risk | Effort |
|------|------------|--------------|------|--------|
| **0** | **`00-bootstrap-strategy-docs.md`** | **Commits the strategy docs into the repo on `main` so every later session can read them. Run this FIRST.** | None | 2 min |
| 1 | `01-system-audit.md` | Read-only sync audit: GitHub ↔ VPS ↔ production. Produces a written report. No code changes. | None | 1–2 hrs |
| 2 | `04-stability-hardening.md` | Sentry on worker+notifier, Redis-backed job store + tailor cache, hh.ru cleanup, legal date sweep, trial plan decision, lower web Sentry sample rates, BASIC/ENTERPRISE env cleanup. | Medium (DB migration) | 1–2 days |
| 3 | `02-resume-quality-upgrade.md` | Better AI prompts (STAR + ATS keywords + critique pass). V2 stored as `.txt` files in `worker/worker/ai/prompts/`. | Low (flag rollback) | 1 day |
| 4 | `03-pdf-templates.md` | 5 ATS-safe PDF templates + picker UI. Adds WeasyPrint to worker. JSON-shape adapter for the existing `resume_text` flow. | Medium | 1–2 days |
| 5 | `05-annual-plans-and-pricing.md` | Annual Pro $199 / Unlimited $299. Pricing toggle. `lib/pricing.ts` rewrite that matches the existing array-`as const` shape. | Medium (Stripe live mode) | 0.5 day |
| 6 | `08-feature-flags-and-ab-testing.md` | Feature flags + experiment harness + seed first 3 experiments. Extends `lib/analytics.ts`. | Low | 1 day |
| 7 | `07-referral-and-affiliate.md` | $20/$20 referral system in-house + Tolt affiliate integration ($29/mo). | Low | 1–2 days |
| 8 | `06-2fa-optional-later.md` | TOTP 2FA. **DEFERRED — do not run until $5K MRR or first enterprise inquiry.** | n/a | n/a |

## Reference files

- **`../STRATEGIC_ANALYSIS.md`** — full strategic context. Competition deep dive, feature decisions, $10K MRR roadmap, marketing channel mix.
- **`../WORKTREE_AUDIT_AND_CORRECTIONS.md`** — drift corrections from a second-pass audit against the real repo. Some prompts have banners pointing here; honor those overrides.
- **`_VPS_VERIFICATION.md`** — the hard-fail VPS sync block to append to every code-changing prompt's "Definition of done."
- **`../_archive/`** — superseded docs preserved for transparency. Do not act on them.

## Operating principles (binding for every prompt)

1. **Read first.** Claude Code reads `STRATEGIC_ANALYSIS.md`, `WORKTREE_AUDIT_AND_CORRECTIONS.md`, the relevant source files, AND `docs/ARCHITECTURE.md` BEFORE making any changes. Each prompt names exactly what to load.
2. **One repo only:** `github.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit`. Every change goes here. No detours.
3. **Branch from main → PR to main → CI deploys to VPS → run VPS verification.** Local-only changes do not count as done.
4. **Feature flags for every user-facing change.** Default OFF in code, enabled in production env after smoke test.
5. **DB backups before any migration that drops columns.** Always.
6. **One concern per PR.** Easier to revert.
7. **Stripe TEST mode first** for any billing change.
8. **No new subsystem until $10K MRR.** The complexity you already have is the limit.

## What's deliberately NOT here

Per `STRATEGIC_ANALYSIS.md` §6:

- **Teams / multi-tenancy** — wrong audience for individual job seekers
- **2FA right now** — deferred to Prompt 06 when revenue justifies it
- **PostHog / analytics platform migration** — Stage 2 at $5K MRR
- **Mobile app** — wait until web conversion is reliable
- **In-house affiliate tracking** — use Tolt ($29/mo) instead
- **Telegram bot** — Chrome extension + web is enough; revisit if data says otherwise

## When you hit milestones — revisit this README

- **$5K MRR** → run Prompt 06 (2FA), migrate flags + experiments to PostHog free tier, hire part-time content writer
- **$10K MRR** → move worker to its own VPS or container service, hire #1 (support → growth marketer)
- **$25K MRR** → consider a proper refactor; that's when ugly-code-but-it-works starts to cost more than rewriting
