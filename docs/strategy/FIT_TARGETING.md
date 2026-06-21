# Targeting principle — only apply where the candidate can actually interview

**Goal (product invariant):** an auto-apply should only fire on roles the candidate is
*genuinely competitive for* — right work-authorization, right level, and a real domain
match. Volume on unwinnable roles is worse than nothing: it burns the daily cap, looks
spammy, and produces the "60 applications, 0 interviews" outcome.

## The three gates we run today
1. **Eligibility** (`lib/eligibility.ts`, worker `eligibility.py`) — work-auth/region
   knockouts + remote-region match. (targeting_v2 flag, on.)
2. **Seniority distance** — skip roles ≥2 levels from the candidate's level.
3. **Job-fit score** (`worker/ai/jobfit.py`, `jobfit_min_score` flag) — skills/keyword
   overlap + seniority + eligibility + language, gated at a threshold.

## The finding (why gate #3 is weak on its own)
Most Greenhouse listings are scraped with `content=false`, so fit is scored on the **title
only**. Two failure modes result:
- **Free baseline ≈ 44/100.** A remote + English + no-seniority-keyword role scores
  eligibility(20) + language(10) + seniority-default(14) = 44 before any domain match — just
  under the 45 gate. Almost everything passes.
- **Short-title inflation.** With only ~3 title tokens, matching one word balloons the skills
  ratio (e.g. resume contains "specialist" → "HR Specialist, Contracts Management" scores
  skills≈26 → total≈70 against an *AI-automation* resume).

Net: on title-only data, token overlap cannot separate "Python Engineer" from "HR
Specialist" for the same resume (both collapse to one shared token). **A denominator floor
makes good and bad scores identical — proven, not shipped.** So gate #3 is a backstop, not
the primary control.

## The real control today: keyword discipline
`run-campaigns` uses **`campaign.keywords[0]`** as the single scrape/match term (the rest of
the array is ignored). It is therefore the de-facto domain filter:
- A **broad** keyword like `specialist` matches HR / marketing / sales / benefits
  specialists → guaranteed rejections. (This is exactly what one live campaign was doing.)
- A **precise** keyword like `python` or `support` only surfaces titles the candidate is
  competitive for.

**Rule:** `keywords[0]` must be a precise, domain-specific term aligned to the resume's
`targetRole` and to where eligible + fillable supply actually exists — never a generic
role-suffix word used alone (`specialist`, `manager`, `analyst`, `coordinator`, `associate`).

## Per-candidate competitiveness (how we pick the target)
Match `keywords[0]` + resume `targetRole` to the intersection of: **eligible** (work-auth) ×
**fillable** (direct-ATS) × **candidate is genuinely competitive**. Worked example
(AU-resident developer, no LinkedIn): generic remote "support" is saturated and unwinnable,
but **Technical Support Engineer at globally-remote dev-tool/infra companies**
(Canonical, Supabase, PostHog, Planetscale, Algolia-Sydney) is a real fit — technical enough
to stand out, not senior, and several hire via written application without a LinkedIn gate.

## The no-LinkedIn lever
For candidates without a LinkedIn: (1) bias targeting toward employers that hire via written
application / value GitHub/portfolio (dev-tool companies), and (2) put a **verifiable
portfolio URL** in the resume header as the LinkedIn substitute.

## Future systemic fix (the proper implementation of this principle)
Fetch the **job description** for the top-N eligible candidates before scoring (Greenhouse
`content=false` hides it at scrape time — fetch per-listing on demand), then run
description-based / semantic fit scoring. With real JD text, gate #3 can separate domain fit
even when a user picks a broad keyword — making "only apply where winnable" automatic for
every future user, not dependent on hand-tuned keywords.
