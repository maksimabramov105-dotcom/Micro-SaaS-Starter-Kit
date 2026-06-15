# Prompt 12 — SEO Audit + Free Daily-Client-Generation Machine


Goal: make organic search + shareable proof generate signups daily at $0 CAC. We already have programmatic SEO routes (`app/jobs-in/`, `app/auto-apply/`, `app/resume/`, `app/alternatives/`, `app/remote/`, `lib/seo-data.json`). Audit, fix, and extend them. Constraints: no fake reviews/testimonials (FTC), no content farms, claims must match what the product really does.

## 1. Technical SEO audit (fix everything found)
1. `sitemap.xml` and `robots.txt` exist, include ALL programmatic pages, and update automatically when seo-data changes.
2. Every page: unique `<title>` ≤60 chars, meta description ≤155, canonical URL, OG/Twitter cards (we have OG images — verify they render), `lang` attribute.
3. Structured data: `SoftwareApplication` + `Offer` (pricing) on landing; `FAQPage` on FAQ-bearing pages; `BreadcrumbList` on programmatic pages.
4. Core Web Vitals: run Lighthouse CI on landing + 3 programmatic pages; fix anything below 90 performance/SEO (images, fonts, blocking JS).
5. Internal linking: every programmatic page links to 3+ sibling pages and to pricing; landing links into the top programmatic hubs.
6. Verify pages return 200 and are indexable in prod (no accidental `noindex`, no auth gates).
7. Add `app/sitemap.ts`-driven count to the admin page so we can watch indexed-page inventory.

## 2. Competitor-gap pages (highest-intent free traffic)
Create programmatic comparison pages from a new `lib/competitors-data.json`: `/alternatives/lazyapply`, `/alternatives/sonara`, `/alternatives/simplify`, `/alternatives/jobcopilot`, `/alternatives/teal`. Each: honest feature table (auto-apply, eligibility check, verified submissions, reply inbox, price), their documented public weaknesses with sources, our 30-day money-back. Honest tone — we cite public reviews, we don't trash-talk.

## 3. Proof page (shareable, daily-updating)
`/proof` — live counters from prod DB: applications verified-submitted, replies received, interview requests, median time-to-first-reply. Cache 1h. This is our anti-LazyApply trust weapon and naturally link-worthy. Add it to the main nav and OG image with the live numbers.

## 4. Free lead magnet
`/ats-check` — public page: paste resume text + job description → jobfit score + 3 specific improvement hints (reuse `worker` jobfit scoring through an unauthenticated, rate-limited API route; cap 3 checks/IP/day via Redis). Email capture optional-but-encouraged to "save your report" → creates Lead → drip is a single follow-up email via Resend (no spam sequences).

## 5. Automation so it runs daily without me
1. Weekly cron (GitHub Actions, like run-campaigns) that regenerates seo-data-driven pages from fresh job/source counts so content stays non-stale.
2. `scripts/seo_health.ts`: checks sitemap reachability, page 200s, title/meta presence — runs in CI, fails loudly.
3. `docs/marketing/seo-runbook.md`: 30-minute weekly founder checklist (GSC review: impressions/clicks per page group, new keyword opportunities, pages to improve).

## 6. Deliverables
- All fixes committed; `docs/audits/seo-audit-<date>.md` with before/after Lighthouse + checklist.
- List of the 10 highest-opportunity keywords found in seo-data vs competitor pages, with suggested new page slugs.

Show me the diff summary before pushing to `main`.
