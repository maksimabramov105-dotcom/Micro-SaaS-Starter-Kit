# SEO Runbook — 30-minute weekly founder checklist

Goal: organic search + shareable proof generate signups daily at ~$0 CAC. Honest only
(no fake reviews, no content farms). Do this once a week (~30 min).

## 1. Google Search Console (10 min)
- Open GSC → Performance → last 28 days. Compare to previous period.
- By **page group**: which of these is growing / flat / declining?
  - `/alternatives/*` (highest-intent — competitor switchers)
  - `/jobs-in/*`, `/auto-apply/*`, `/resume/*`, `/remote/*` (programmatic)
  - `/proof`, `/ats-check` (lead magnets)
- Note the **top 5 queries with impressions but low CTR** → those titles/descriptions need a rewrite.
- Note the **top 5 queries on page 2 (positions 11–20)** → those pages need one more internal link + a content nudge to reach page 1.
- **Coverage/Pages**: confirm indexed-page count is rising (cross-check `/admin/pmf` → "SEO pages indexed").

## 2. Pages to improve (10 min)
- Pick the ONE page with the best impressions-to-clicks gap. Improve its `<title>` (front-load the keyword, ≤60 chars) and meta description (≤155, add the benefit + "free").
- Add one fresh internal link to it from a sibling page.
- If a competitor page is ranking, verify the comparison is still accurate (prices change) — update `lib/seo-data.json`.

## 3. New opportunities (5 min)
- Skim GSC "Queries" for any term we don't have a page for. Candidates → add a row to
  `lib/seo-data.json` (`countries` / `jobBoards` / `professions`) or a competitor to `competitors`.
  The sitemap + pages regenerate automatically; no code beyond the data row.
- See `docs/audits/seo-audit-2026-06-11.md` for the current top-10 keyword/slug backlog.

## 4. Health (5 min)
- CI runs `scripts/seo_health.ts` on every deploy (sitemap/robots reachable, key pages 200 + title/meta/canonical). If it's red, fix before anything else.
- Spot-check `/proof` shows real, non-zero numbers and the date isn't stale.
- Submit/refresh the sitemap in GSC if you added many pages.

## Guardrails (never break)
- No fabricated reviews/testimonials/counters (FTC). `/proof` shows only real DB numbers.
- Competitor claims must be verifiable — keep the `sources` links accurate.
- Never `noindex` a public marketing page; never gate it behind auth.
