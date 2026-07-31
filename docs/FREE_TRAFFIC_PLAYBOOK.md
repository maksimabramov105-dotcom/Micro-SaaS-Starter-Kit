# Free traffic playbook

Written 2026-07-31, right after the `.ru` → `.com` migration. Every number here
was read from the live system, not estimated.

**Where you actually stand:** 301 indexed-quality URLs, all returning 200, all
conversion-wired (free fit-check + $4.99 tripwire CTAs on every one). Zero paid
spend. The whole job now is getting those pages *found*, and getting humans to
places that convert.

Ordered by **effort-to-payoff**, not by how exciting it sounds.

---

## 0. The migration tax you must pay first (do this today)

Moving domains temporarily costs rankings. These three steps are what stop that
from being permanent. Nothing else in this document matters as much this week.

### 0.1 Google Search Console — add `.com` AND keep `.ru`

1. https://search.google.com/search-console → **Add property** → **Domain** →
   `resumeai-bot.com` → verify via **DNS TXT** (Cloudflare → DNS → Records →
   Add record → TXT, name `@`, value the one Google gives).
2. Do **not** delete the `.ru` property. You need it for the next step.

### 0.2 Change of Address (the single highest-value click in this document)

In Search Console, select the **`.ru`** property → **Settings** → **Change of
address** → choose `resumeai-bot.com` → Validate & Update.

This is what tells Google "these are the same site, move the rankings." Without
it, the 301s still work but the transfer is slower and leakier. It requires the
`.ru` → `.com` 301 to be live, which it already is (verified: `/pricing` →
`301 → https://resumeai-bot.com/pricing`).

### 0.3 Submit the sitemap on the new property

Search Console → `.com` property → **Sitemaps** → submit `sitemap.xml`.
It now renders per request, so it already emits `.com` URLs (fixed in #180).

### 0.4 Bing Webmaster Tools (2 minutes, do not skip)

https://www.bing.com/webmasters → **Import from Google Search Console** — it
copies the property and sitemap in one click. Bing also feeds DuckDuckGo,
Ecosia and ChatGPT search, so it is more traffic than its market share suggests.

**Already automated, nothing to do:** IndexNow submits every URL on publish and
weekly (Bing/Yandex/Seznam/Naver accepted all 301 URLs — verified). Google has
no equivalent ping; the sitemap plus Search Console is the path.

---

## 1. Free channels ranked by effort-to-payoff

| # | Channel | Effort | Realistic payoff | Who |
|---|---|---|---|---|
| 1 | Search Console + change of address | 15 min | Protects everything already built | You |
| 2 | Bing import | 2 min | +10-20% of Google volume, ~free | You |
| 3 | Chrome Web Store SEO | 1 h at listing time | Store search is a real, uncompeted channel | You |
| 4 | Reddit / Discord answers | 30 min/day | First 100 users realistically come from here | You |
| 5 | Build-in-public content | 2 posts/week | Compounds; feeds testimonials | You |
| 6 | Comparison + alternatives pages | done (10 live) | Highest commercial intent of any SEO we have | ✅ shipped |
| 7 | Programmatic company pages | done (169 live) | Long-tail, low competition | ✅ shipped |

---

## 2. Chrome Web Store — the most underrated free channel

When the extension ships (Phase 2), the store listing is a **search engine you
are not yet competing in**. Treat it like SEO:

- **Title**: include the query, not just the brand. `ResumeAI — Job Application
  Autofill & Resume Tailoring` beats `ResumeAI`.
- **Short description** (132 chars) carries the most ranking weight. Front-load
  the terms people type: *autofill job applications*, *tailor resume*,
  *Greenhouse Lever Ashby*, *ATS*.
- **Screenshots** are the conversion lever: show the autofill happening on a
  real Greenhouse form, not a logo.
- Ask the beta cohort (P5.4) for reviews in the first week. Early rating volume
  drives store ranking harder than anything else.
- Link the listing from the site and the site from the listing — both directions
  count.

---

## 3. Where the first 100 users actually come from

SEO compounds but it is slow, and you need activated users to validate the
pivot. These communities are where job-seekers already are. **Answer questions,
do not drop links** — every one of these bans promo posts, and the honest-data
angle is what makes it welcome:

- r/jobs, r/resumes, r/cscareerquestions, r/jobsearchhacks, r/EngineeringResumes
- Blind, Hacker News (Show HN once the extension is live)
- Discord: Rands Leadership, various job-hunt servers

**The unfair advantage:** you have real telemetry nobody else publishes —
verified ATS submissions, actual reply rates, median days-to-reply. A comment
that says *"we tracked 300+ verified submissions; here's the real reply rate"*
is genuinely useful and gets upvoted. A comment that says "try my tool" gets
removed.

`/proof` is the landing page for exactly this traffic — it is the one page no
competitor can copy, because they don't have the ledger.

---

## 4. Content that only you can write

Two posts a week, both drawn from data you already collect:

1. **Telemetry posts** — "What happens to 300 job applications" using the live
   `/proof` numbers. Unique, quotable, links back naturally.
2. **Build-in-public** — including the failures. The six-day outage, the
   magic-link bug that meant sign-in emails never sent, the pricing page that
   advertised an expired promo for seven weeks. This audience rewards candour
   and it is on-brand: honesty *is* the positioning.

Cross-post to dev.to, Hashnode and Medium with a canonical link back to
`resumeai-bot.com` so the ranking accrues to you, not them.

---

## 5. What NOT to spend time on

- **Backlink schemes / directory blasts** — actively harmful now that you have a
  clean new domain with no spam history. Do not risk it.
- **More programmatic pages for the sake of count.** 301 URLs is plenty until
  they're indexed and converting. The `>=300-word` and duplicate-description
  build guards exist to stop exactly this temptation.
- **Paid ads before activation works.** Sending paid traffic to a funnel with an
  unproven activation rate burns money to learn what free traffic teaches free.
- **Fake urgency, fake counters, fake testimonials.** Beyond being wrong, it
  contradicts the one thing that differentiates the product.

---

## 6. Measuring it

Everything below already exists:

- `AnalyticsEvent` — `page_view` with referrer, so channel attribution is there.
- Daily pulse (Telegram, ~9am Sydney) — unique visitors, top pages, top
  referrers, leads, sales.
- `/admin/pmf` — funnel dashboard.
- `seo_health` cron — daily 200-check over all sitemap URLs.

**The number that matters** is not traffic. It is `lead_captured` and
`tripwire_paid` per referrer. A channel that sends 50 visitors and 3 leads beats
one that sends 500 and none — and the daily pulse already reports both.
