# Prompt 13 — Visual Trust & Conversion Redesign (landing + all public pages)

Copy everything below into Claude Code, run from `~/code/Micro-SaaS-Starter-Kit`.
Audit basis: live site review 2026-06-10. Design language: Tailwind + shadcn defaults (white / slate / emerald-600 accent), emoji icons, text-only hero.

---

You are redesigning the public-facing surface of resumeai-bot.ru for trust and conversion. The product promises to "apply to jobs while you sleep" — visitors must trust us with their resume, personal data, and $19.99+. Every change below is ranked. No fake testimonials, no fake counters, no dark patterns (FTC). Keep Tailwind + existing component structure; this is a restyle, not a rewrite.

## P0 — Trust killers (fix immediately, <1 day)

1. **Expired urgency banner.** `components/launch-banner.tsx` shows "40% off… Ends June 8" — it is past June 8. An expired countdown is the single fastest way to look like a scam, and fake/stale urgency is an FTC dark-pattern risk. Make the banner data-driven: store `endsAt` + promo code in one config; auto-hide after expiry; never render a past date. Add a unit test.
2. **Contradictory proof counters.** Hero stats show "234 applications submitted / 31 confirmed received by employers" while the caption says a job only counts as submitted after the ATS accepts it — the two numbers contradict the caption. Fix the definitions: rename to "applications sent" and "confirmed by employer ATS", make both query real DB statuses, and have the caption match exactly. If a number is small, present it as freshness ("this week") rather than all-time smallness.
3. **Overpromise in final CTA.** "Upgrade only when you see the interviews come in" implies guaranteed interviews. Replace with the honest mechanic: "Start free. Upgrade when you see confirmed applications and replies in your inbox."
4. **Risk flag to report (do not fix in code): the `.ru` domain.** For an audience seeking jobs abroad, a .ru TLD is a major trust barrier (perception + some corporate networks block it). Output a short migration note: cost/steps of adding a `.com` or `.io` primary with 301s from .ru (Caddy + NEXTAUTH_URL + Stripe/Resend domain updates). I will decide separately.

## P1 — Visual identity: stop looking like a template (1–2 days)

5. **Color system.** Current palette is default shadcn slate + emerald-600 used for everything (logo, CTAs, badges). Keep emerald as the brand/action color (green reads as "go / money / safe" — right instinct for this product) but build hierarchy:
   - Define brand tokens in `tailwind.config.ts`: `brand` (emerald-600), `brand-deep` (emerald-800 for hover/headers), one warm contrast accent reserved ONLY for the primary CTA per screen (e.g. amber-500 or keep emerald but make every other button neutral) — the rule: exactly one high-emphasis CTA visible per viewport.
   - Add a `trust` neutral surface (slate-50) rhythm: alternate white/slate-50 sections (already partially done) and ensure 4.5:1 contrast everywhere (`text-slate-500` on white at 14px fails for body text — bump body copy to slate-600).
6. **Typography.** Default font = anonymous. Load Inter (or Geist) via `next/font` with tighter display tracking for h1/h2; set a type scale (h1 56/48, h2 32, body 16/17). One font, two weights — no font zoo.
7. **Replace emoji icons** (✅🌍🤖📨) with lucide-react icons in emerald-100 circles. Emojis render inconsistently across OS and read as low-effort — directly undermines the "we handle your career" promise.
8. **Logo:** text-only "ResumeAI" in emerald. Create a simple SVG mark (paper-plane/checkmark motif), favicon set, and consistent OG image branding.

## P2 — Eye-flow & retention (2–3 days)

9. **Hero has no visual anchor.** Currently: centered text, 2-sentence headline, white void. Eye-tracking basics: the gaze needs a focal object and a face or product. Restructure to split hero: left — tightened headline (max 9 words: "Your job search, on autopilot — only where you're eligible") + subhead + CTA; right — **product proof visual**: an auto-playing, reduced-motion-aware looped animation (CSS/SVG, no video file) of the dashboard submitting applications: job card → "tailoring resume…" → "submitted ✓ confirmed by ATS". Build it as a real component (`components/hero-demo.tsx`) using the actual dashboard UI styles, fed by sample data — it doubles as a product tour.
10. **Live proof module instead of testimonials.** We cannot show fake reviews. Move the counters into a designed "Live activity" card with a subtle pulse dot ("live"), last-confirmed-application timestamp, and link to `/proof`. Real data, designed well, beats stock testimonials.
11. **Directional cues.** Each section should end with a visual pointer to the next (numbered steps already exist — good). Add scroll-margin anchors and make the sticky CTA (`components/sticky-cta.tsx`) appear only after the pricing section is passed, with the chosen plan.
12. **Comparison table** is our best section — promote it higher (right after "Why choose us"), add product favicons/names styled as chips, highlight our column with emerald-50 background, and a one-line source link per competitor claim (review links) for credibility.
13. **Pricing cards:** "Most popular" badge exists — also add per-plan value anchor ("≈ $0.66 per application day") and make the Free card visually de-emphasized (border only) so the eye lands on Pro.

## P3 — Dashboard (the retention surface)

14. Apply the same token system to the dashboard. Add the "aha" celebration: when an INTERVIEW_REQUEST is classified, show a full-width congratulation banner with confetti (CSS only) — this is the moment users screenshot and share.
15. Empty states: every dashboard list (applications, inbox, resumes) needs a designed empty state with one next-step CTA, not a blank table.

## Acceptance checks
- Lighthouse accessibility ≥ 95 on landing (contrast fixes verified).
- No date-bearing promo can render past its end date (test).
- Counter numbers + captions come from one source of truth and cannot contradict.
- Exactly one primary CTA per viewport at 1440px and 390px widths.
- Screenshot diff of landing before/after attached to the PR description.

Show me the diff summary and before/after screenshots (Playwright `page.screenshot`) before pushing to `main`.
