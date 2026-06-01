# Growth / distribution assets — ResumeAI-Bot

Copy-paste marketing assets for the 30-day, zero-budget push. These are
founder-facing reference docs (not app code). Everything here is written to be
**truthful** about what the product actually does — please keep it that way.

## What the product actually does (use these claims, not inflated ones)
- AI builds an **ATS-ready resume tailored per role**, then **auto-submits
  applications** to open roles on company career sites / ATS (e.g. Greenhouse)
  across **many countries**. Positioning headline: *"apply to jobs in 50+
  countries."*
- **No job-board passwords required** for the core auto-apply (it fills public
  application forms using your resume + a dedicated ResumeAI email). LinkedIn is
  the only optional path that needs a login.
- **Free tier:** 3 applications/day, no credit card. **Pro** $19.99/mo or
  $199/yr · **Unlimited** $29.99/mo or $299/yr. **30-day money-back guarantee.**
- **Launch offer:** code `LAUNCH40` = 40% off the first year (expires ~Jun 8,
  first 50 redemptions).
- **Do NOT claim:** auto-apply to LinkedIn/Indeed/ZipRecruiter without login,
  fake user counts, fake testimonials, or fake MRR. Cold traffic to a `.ru` AI
  tool is already skeptical — a single exaggeration kills trust.

## Ground rules (so you don't get banned or burn goodwill)
- **Reddit:** most job subs (r/jobs, r/resumes, r/cscareerquestions) **ban
  self-promotion**. Lead with genuine help; mention the tool only when relevant
  and ideally when asked, or in subs/threads that allow it. Build comment karma
  first. Read each sub's rules + use their promo threads where required. The free
  **resume teardown** is your goodwill on-ramp — give value, collect DMs/emails,
  don't drop links into every thread.
- **One link per post max.** Use `?ref=` tags so analytics attributes the
  channel (e.g. `resumeai-bot.ru/?ref=reddit-iwantout`).
- **Disclose** you're the founder when you mention your own tool. Honesty reads
  as confidence; stealth-shilling gets you banned.

## Attribution: tag every link
Append a `?ref=` (and/or `utm_source`) so the first-party tracker logs the source:
| Channel | Link to share |
|---|---|
| Reddit | `https://resumeai-bot.ru/?ref=reddit` (or `?ref=reddit-<sub>`) |
| Telegram | `https://resumeai-bot.ru/?ref=tg` |
| X / Twitter | `https://resumeai-bot.ru/?ref=x` |
| LinkedIn | `https://resumeai-bot.ru/?ref=linkedin` |
| Product Hunt | `https://resumeai-bot.ru/?ref=ph` |
| Hacker News | `https://resumeai-bot.ru/?ref=hn` |
| Directory | `https://resumeai-bot.ru/?ref=<directory>` |

Read traffic back with the SQL in `docs/HANDOFF.md` / project notes (AnalyticsEvent → `properties->>'ref'`).

## Files
- `reddit-and-forums.md` — value-first posts/comments + the free-teardown offer.
- `build-in-public.md` — X/LinkedIn posts (no fabricated metrics).
- `product-hunt-launch.md` — PH kit + Show HN + BetaList blurbs.
- `outreach-and-directories.md` — cold-DM templates + 20 free directories.

## Google Search Console checklist (mostly DONE)
- [x] Property `https://resumeai-bot.ru/` verified.
- [x] `sitemap.xml` submitted (86 URLs, processed).
- [ ] Weekly: check **Indexing → Pages** for coverage + errors.
- [ ] **URL Inspection → Request indexing** for 3–5 priority pages after each
  publish (e.g. `/alternatives/sonara`, `/jobs-in/germany`, `/compare`). Don't
  exceed the daily quota.
- [ ] Watch **Performance** for first impressions (~1–2 weeks out).

## 30-day calendar (cash goal: ~4–6 annual subs = ~$1k)
**Week 1 — go live + start distribution**
- Day 1: Post the free **resume teardown** offer in 1–2 relaxed subs (r/resumes
  weekly thread, r/IWantOut) + 1 build-in-public post. Start logging DMs.
- Days 2–7: 20 helpful comments/day across target subs (value-first, soft mention
  only where allowed) + 1 build-in-public post/day + 10 personalized DMs/day to
  people complaining about job search.
- Day 5: Make sure `/free-resume-teardown` is the link you funnel teardown
  requests to (it captures emails).

**Week 2 — spike**
- Day 8–9: Submit to 10 directories (see `outreach-and-directories.md`).
- Day 10: **Show HN** + **BetaList**.
- Day 12: **Product Hunt** launch (Tue–Thu, 00:01 PT). Line up a hunter + have
  the first comment + FAQ ready (`product-hunt-launch.md`). Rally your DM list.
- Continue daily Reddit value + DMs.

**Weeks 3–4 — compound**
- Publish 2–3 new SEO/comparison angles per week (you have the data file; add
  countries/professions/boards to `lib/seo-data.json`).
- Keep daily comments + DMs. Convert the email list (teardown recipients) with a
  short "your teardown + how auto-apply finishes the job, 40% off with LAUNCH40"
  follow-up.
- Re-request indexing for new pages; review GSC Performance.

> Reality check from your plan: **SEO pays off in months 2–6, not this month.**
> Your 30-day cash comes from Tier-1 manual distribution + the launch offer.
> Push **annual** plans (toggle already defaults to yearly).
