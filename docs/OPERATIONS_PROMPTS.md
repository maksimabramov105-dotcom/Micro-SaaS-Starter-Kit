# Operations prompts — post-launch ResumeAI

> These prompts run on the live system. They're for fixing issues, verifying state, and shipping new features — not for rebuilding.

---

## ⚙️ Block discipline protocol (read once, applies to every prompt below)

**The system is built as 9 blocks, defined in `ARCHITECTURE.md` § 2.** Every prompt below specifies which blocks it touches and which it must NOT touch. Following this discipline is the difference between surgical work that stays stable and the spaghetti-that-broke-everything pattern of the legacy system.

**Mandatory steps for every prompt:**

**Before you start:**
1. Read `ARCHITECTURE.md` § 2 (the 9-block table) — confirm you understand the boundaries.
2. Read the **"Block scope"** section of the prompt you're about to run — note the ALLOWED files and the FORBIDDEN files.
3. Read `COMPETITIVE_ANALYSIS.md` and `PMF_FRAMEWORK.md` if the prompt references a feature or metric from them (prompts 19–23 all do).
4. Create a fresh git branch — every prompt has a suggested branch name at the bottom.

**While you work:**
- Touch only files inside the ALLOWED set. If you find yourself about to edit a file in the FORBIDDEN set, STOP. Either the prompt is wrong (re-read; ask for clarification) or you've discovered a missing block (add a row to `ARCHITECTURE.md` § 2 first, then continue).
- DB schema changes go in a separate PR before the feature PR. Migrations always come first.
- The web ↔ worker contract is `lib/worker-client.ts` ↔ `worker/routes/jobs.py`. Never reach across this boundary any other way.

**Before you commit:**
1. Run the **block-isolation check** — make sure your diff stays inside the allowed paths:
   ```bash
   # Replace ALLOWED_PATHS with the comma-separated set from the prompt's Block scope section.
   git diff --name-only main | grep -vE '^(ALLOWED_PATHS)' || echo "✅ block isolation OK"
   ```
   If the command prints any filenames, you've drifted outside scope. Investigate before committing.
2. Run `npm run build` (web) and `cd worker && uv run pytest` (worker) — both green.
3. Run the prompt's Cyrillic check (where applicable): `grep -rIl --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=docs -P '[\p{Cyrillic}]' app components lib prisma worker` → zero results.
4. Update `docs/ARCHITECTURE.md` in the SAME PR if you added or moved a block. If you didn't, leave it untouched.

**PR description template (copy-paste into every PR):**
```
Prompt: <which prompt this PR fulfills>
Blocks touched: <list from prompt's Block scope>
Blocks NOT touched (forbidden by scope): <list — confirms you stayed in lane>

Block-isolation check: ✅ ran `git diff --name-only main` against allowed paths

Tests: <green/red counts>
PMF impact: <which metric in PMF_FRAMEWORK.md this is supposed to move, and how you'll verify>
```

If you can't fill in every line above, the PR isn't ready.

When your ready- ask for promt

---

## PROMPT 15 — Pre-launch QA (gate before any paid marketing)

**Run in:** local repo + VPS log inspection.
**Goal:** Prove the whole system works end-to-end as one organism. Single gate before paying for ads.

```text
═══ REQUIRED READING (do not skip) ═══
1. ARCHITECTURE.md § 1 (topology) and § 2 (9-block table). You are
   verifying the whole system end-to-end — you need to know every block
   and how they connect.
2. PMF_FRAMEWORK.md § 2 (the 12 dashboard metrics). G5-G7 below verify
   they exist.

Block scope: this prompt READS everything, WRITES only:
  - docs/qa/launch_readiness_2026-MM.md (new file)
  - app/api/_debug/raise/route.ts (temp, deleted in step G1)
  - prisma/SCHEMA_NOTES.md (only if you find missing indexes)
You are NOT making feature changes here. If a check fails, file an issue
and run the matching prompt (19/20/21/22/23/16) to fix.

═══ TASK ═══

Run pre-launch QA on the live ResumeAI system. Produce a signed-off
checklist proving the system works end-to-end before any marketing dollar
is spent. Every failed check must be FIXED before sign-off, not waived.

Create `docs/qa/launch_readiness_2026-MM.md` with this structure and fill
each section. At the end, every line must be ✅ or launch is blocked.

═══ A. Static code health ═══

A1. npm run lint — zero errors, zero warnings.
A2. npm run build — green.
A3. npm test — green, coverage ≥ 70% on lib/.
A4. cd worker && uv run pytest --cov=worker — green, ≥ 70%.
A5. Cyrillic check on source (NOT docs):
       grep -rIl --include='*.ts' --include='*.tsx' --include='*.py' \
         --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=docs \
         -P '[\p{Cyrillic}]' app components lib prisma worker
    Zero files.
A6. Legacy artifact check:
       grep -ri 'hh\.ru\|superjob\|yandex\|cryptobot.*RUB\|resumeaibot' \
         app components lib prisma worker
    Zero hits.
A7. cd worker && uv run bandit -r worker/ — no HIGH-severity.
A8. npm audit --audit-level=high — exit 0.

═══ B. Database integrity ═══

B1. docker compose exec web npx prisma migrate status — "up to date".
B2. docker compose exec web npx prisma validate — schema valid.
B3. Indexes on hot paths:
       \d "JobApplication"  — (userId, createdAt), (status) present
       \d "JobListing"      — unique (source, externalId), scrapedAt indexed
B4. Foreign-key check from JobApplication + AutoApplyCampaign → User, Resume.
B5. Restore drill: yesterday's pg_dump → resumeai_restoredrill DB →
    sample query → drop. Checksum matches what backup_db.sh recorded.

═══ C. Functional E2E (Playwright, incognito) ═══

C1. Sign up via /signin with test Google → /dashboard, User row created.
C2. Build resume /dashboard/resumes/new → AI generation < 20s → Resume row
    with generated JSON → PDF link works.
C3. Create LinkedIn campaign → ≥1 application sent in 10 min → DB row SUBMITTED.
C4. Create API-board campaign (Adzuna) → submissions land.
C5. Toggle campaign OFF → no further sends in next 5 min.
C6. Withdraw an application → WITHDRAWN in DB.
C7. Manual application via /dashboard/applications/new → saves + appears.
C8. Stripe checkout Pro → User.planTier = PRO → dailyApplicationLimit raised.
C9. Stripe webhook test from dashboard → User updates accordingly.

═══ D. Country & quality gates ═══

D1. Inject JobListing with company_country='RU' → worker logs
    blocked_by_country_gate, never sends.
D2. Inject JobListing with spam keyword (MLM, commission-only, no-salary) →
    worker skips with reason.
D3. Quota: user at PRO (50/day) + 60 queued → exactly 50 send, 10 queue.

═══ E. Performance ═══

E1. k6 100 RPS on /api/health for 60s — p95 < 250ms.
E2. /dashboard/applications with 1k seeded rows loads < 2s.
E3. Resume generation cold-start p95 < 25s.
E4. docker stats — no container > 80% mem at idle.

═══ F. Security ═══

F1. /api/* requiring auth return 401 without session.
F2. /api/worker/* requires Bearer WORKER_SECRET; wrong/empty → 403.
F3. Tamper JWT cookie → 401.
F4. File upload: oversize → 413, wrong MIME → 415, traversal → sanitized.
F5. Stripe webhook without signature → 400.
F6. ENCRYPTION_KEY SHA-256 matches between web + worker.
F7. No PAT in /opt/resumeai/.git/config.

═══ G. Observability ═══

G1. Trigger error via temp /api/_debug/raise route → Sentry receives within
    1 min → delete the route.
G2. PostHog (or Plausible) firing: page_view, signup, resume_built,
    application_sent, plan_purchased, interview_received,
    subscription_canceled, refund_requested — all visible.
G3. Daily reporter cron → /var/log/resumeai/daily.log non-empty + admin
    webhook fired.
G4. Uptime Kuma — all monitors GREEN.
G5. PMF dashboard at /admin/pmf renders (built in Prompt 23). All 12
    metrics show numbers (even if zero — must not throw).
G6. Interview-rate survey is live: /api/surveys/interview-check responds
    200 for an authed user 30 days past signup (built in Prompt 23).
G7. Exit-reason capture on cancellation: /dashboard/billing → Cancel →
    modal forces an exit reason from a fixed list before allowing cancel
    (built in Prompt 23).

═══ H. Marketing readiness ═══

H1. Landing: hero + one primary CTA, demo, testimonials/stat callouts,
    pricing USD, FAQ, footer Privacy + Terms. All English.
H2. Lighthouse /: Perf ≥ 80, SEO ≥ 90, A11y ≥ 90.
H3. OG: linkedin-post-inspector returns valid preview.
H4. robots.txt + sitemap.xml present, English routes only.
H5. /terms + /privacy have real content, not placeholders.

═══ I. Rollback drill ═══

I1. Yesterday's deploy commit: docker compose pull <prev-tag> → up -d.
    Verify via /api/_version. Roll forward. Downtime < 60s.

═══ SIGN-OFF ═══

For each of A–I: ☐ all checks ✅ + signature + date.

Commit:
   git add docs/qa/launch_readiness_2026-MM.md
   git commit -m "[QA] Launch readiness 2026-MM — signed off"
   git push

Deploy:
   ssh <vps> 'cd /opt/resumeai && git pull && docker compose pull && \
              docker compose up -d && sleep 10 && \
              curl -fsS https://resumeai-bot.ru/api/health && \
              curl -fsS https://resumeai-bot.ru/api/worker/health'

Both 200 = launch ready. Either fails → immediate rollback per I.
```

---

## PROMPT 16 — Autoapply success-rate iteration (Week 5–6, weekly cadence)

**Run in:** local repo + VPS for DB inspection.
**Goal:** Identify the worst-performing scraper or sender each week and fix the dominant failure mode. One engine per PR.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 row 6 (Scraping) and row 7 (Sender). This prompt
   touches one of these — figure out which based on what's failing.
2. PMF_FRAMEWORK.md § 1 Test 1 (interview rate is the real metric, not
   submission rate). Step 5 below enforces this.

Block scope:
  ALLOWED to touch (pick ONE engine per PR):
    - worker/autoapply/<engine>.py            (Sender block)
    - worker/scrapers/<board>.py              (Scraping block)
    - worker/tests/test_autoapply_<engine>.py (matching test)
    - worker/autoapply/CHANGELOG.md           (note the iteration)
  FORBIDDEN to touch:
    - Any other engine or scraper             (one engine per PR rule)
    - app/, components/, lib/                 (web side — different blocks)
    - prisma/schema.prisma                    (schema is its own PR)
    - Auth, Billing, Resume domain blocks     (out of scope)

═══ TASK ═══

Iterate on autoapply success rate. Identify the worst path, fix the
dominant failure, ship, measure delta a week later.

═══ STEP 1 — Quantify ═══

1.1. On VPS:
       docker compose exec postgres psql -U resumeai -c "
         SELECT source, status, COUNT(*)
         FROM \"JobApplication\"
         WHERE \"createdAt\" > now() - interval '7 days'
         GROUP BY source, status ORDER BY source, status;
       "
1.2. Compute per-source success rate = SUBMITTED / (SUBMITTED + FAILED).
     Table sorted WORST first.
1.3. Pull 20 sample FAILED rows for the worst source:
       SELECT id, "jobUrl", "errorMessage", "createdAt"
       FROM "JobApplication" WHERE source = '<worst>' AND status = 'FAILED'
       ORDER BY "createdAt" DESC LIMIT 20;
     Group by errorMessage — what's the dominant failure mode?

═══ STEP 2 — Reproduce ═══

2.1. Pick one failed jobUrl from the dominant failure mode.
2.2. In dev:
       cd worker && uv run python -c "
         from worker.autoapply.<engine> import <Applicator>
         import asyncio
         asyncio.run(<Applicator>().apply('<jobUrl>', <test-resume-id>))
       "
2.3. Capture full trace + Playwright screenshot at point-of-failure.

═══ STEP 3 — Diagnose ═══

Categorize: selector drift / captcha / rate limit / new required field /
login expired / network timeout / job expired between scrape+apply.
Document the diagnostic signature for future classification.

═══ STEP 4 — Fix ═══

Touch ONLY worker/autoapply/<engine>.py (surgical — that block only).
Add a regression test in worker/tests/test_autoapply_<engine>.py that
reproduces the bug without the fix and passes with it.

═══ STEP 5 — Ship + measure (both submission AND interview rate) ═══

Deploy. Wait 24h. Re-run STEP 1.1 query for same source. Compute delta.

ALSO measure downstream — submission rate is not the goal, interview rate is.
Per PMF_FRAMEWORK.md:
   docker compose exec postgres psql -U resumeai -c "
     -- 7-day interview rate per source (positive recruiter reply within 14 days of submit)
     SELECT a.source,
       COUNT(*) FILTER (WHERE a.status = 'SUBMITTED') AS submitted,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM \"ApplicationEvent\" e
         WHERE e.\"applicationId\" = a.id
           AND e.type = 'interview_requested'
           AND e.\"createdAt\" < a.\"createdAt\" + interval '14 days'
       )) AS got_interview,
       ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (...)) /
             NULLIF(COUNT(*) FILTER (WHERE a.status = 'SUBMITTED'), 0), 1) AS interview_pct
     FROM \"JobApplication\" a
     WHERE a.\"createdAt\" > now() - interval '14 days'
     GROUP BY a.source ORDER BY interview_pct DESC NULLS LAST;
   "

Append to worker/autoapply/CHANGELOG.md:
   ## Week of 2026-MM-DD
   Before: <engine> submission <X>%, interview <X_i>%
   Cause:  <one sentence>
   Fix:    <one sentence>
   After:  <engine> submission <Y>%, interview <Y_i>%

If submission went UP but interview rate stayed flat or dropped, you've
shipped a quality regression. Roll back the change and pick a different fix.

═══ STEP 6 — Next iteration ═══

Repeat weekly. Stop iterating on an engine when submission > 85% AND
interview rate > 10% (PMF threshold), sustained 2 weeks. Move to next-worst.
```

---

## PROMPT 17 — Chrome extension for career-page autofill (Week 7)

**Run in:** local repo, new branch.
**Goal:** Ship a thin Chrome extension that autofills application forms on company career pages using the user's stored ResumeAI resume. Closes the "Simplify gap" identified in COMPETITIVE_ANALYSIS.md.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 (you are adding a NEW block: Extension — add a
   row to the table in the same PR).
2. COMPETITIVE_ANALYSIS.md § 2 row 6 (Simplify owns career-page autofill
   for 100K+ companies — this prompt closes that gap).
3. ARCHITECTURE.md § 3 "Adding a new block" rules — contract first, then
   implementation.

Block scope:
  ALLOWED to touch:
    - extension/                              (entire new directory)
    - app/extension/connect/page.tsx          (new — onboarding handshake)
    - app/api/extension/**                    (new — bearer-auth endpoints)
    - lib/extension-auth.ts                   (new — API key validator)
    - docs/extension.md                       (new — privacy + install)
    - docs/ARCHITECTURE.md                    (add a row: Extension block)
    - .github/workflows/ci.yml                (only to add the extension lint)
  FORBIDDEN to touch:
    - worker/**                               (Python autoapply unchanged)
    - app/dashboard/**                        (existing dashboard untouched)
    - app/api/applications/**, app/api/campaigns/**  (separate blocks)
    - lib/auth.ts, lib/stripe.ts              (Auth + Billing blocks)
    - prisma/schema.prisma                    (no schema changes — reuse ApiKey)

═══ TASK ═══

Build a Chrome Manifest V3 extension. Autofill only (no auto-submit) —
matches Simplify's quality-first model and avoids the LazyApply reputation trap.

═══ User flow ═══

1. Install from Chrome Web Store.
2. First use → opens https://resumeai-bot.ru/extension/connect → sign in →
   page generates API key → extension captures via postMessage → stored
   in chrome.storage.local.
3. Visit career page → extension detects application form (≥3 input fields
   matching common application names).
4. Floating "Autofill with ResumeAI" button appears.
5. Click → fetches resume from /api/extension/resume → fills fields.
6. User reviews + submits manually.
7. Optional "Track this application" → POST /api/extension/applications
   → appears in dashboard.

═══ Repo structure ═══

extension/
  manifest.json          # MV3
  background.js          # service worker, onboarding
  content/
    detect.js            # form detection heuristic
    autofill.js          # fill detected fields
    overlay.css overlay.js  # floating button (shadow DOM CSS isolation)
  popup/
    popup.html popup.js  # status, settings, sign-out
  icons/16 32 128.png

Web side (new endpoints in the Extension block):
  app/extension/connect/page.tsx
  app/api/extension/resume/route.ts        # GET, bearer auth
  app/api/extension/applications/route.ts  # POST, bearer auth
  lib/extension-auth.ts                    # validates API key

═══ Steps ═══

1. Scaffold extension/. Permissions: storage, activeTab, scripting.
   host_permissions: only resumeai-bot.ru.

2. detect.js — match input names/ids against:
   first_name|firstName|fname|given_name
   last_name|lastName|lname|surname|family_name
   email|e-mail|mail
   phone|tel|mobile|phone_number
   resume|cv|file
   linkedin|linkedin_url|profile
   cover_letter|motivation|why
   Score: ≥3 matches = application form.

3. autofill.js — given resume JSON, map to text/textarea/select/file inputs.

4. Overlay button — shadow DOM CSS isolation so host page styles don't leak.

5. Onboarding handshake:
   - app/extension/connect/page.tsx (auth-protected). Server action creates
     ApiKey with scope='extension'. Returns to client.
   - Client: window.postMessage({ resumeai_api_key: '<key>' }, '*')
   - Extension content script (injected on resumeai-bot.ru) listens + stores.

6. Web API: lib/extension-auth.ts validates Bearer + sets userId.
   Rate-limit 60 req/min/key.

7. Test on 3 ATS: Greenhouse, Workday, Lever. Each ≥50% fields filled.

8. CI: lint extension JS + unit tests.

9. Package: extension.zip ready for Chrome Web Store.

10. docs/extension.md: install, privacy (no data leaves browser except
    authenticated API calls), permissions justification.

═══ Block isolation (surgical scope) ═══

Do NOT touch:
- Worker (Python autoapply unchanged)
- Sender block
- Existing dashboard

Touch only:
- Auth (user must be signed in to onboard)
- Resume domain (read-only fetch)
- API key block (reuse — don't invent new key system)
- NEW Extension block (everything in extension/)

═══ Acceptance ═══

- Install + onboarding < 60s
- Autofill works on Greenhouse + Workday + Lever
- 0 changes to worker/ in this PR
- /api/extension/* unit-tested
- docs/extension.md exists

Commit on feat/chrome-extension, open PR.
```

---

## PROMPT 18 — Thin Telegram notification bot (Week 8)

**Run in:** local repo, new branch.
**Goal:** Pure outbound notification channel — no commands, no menus, no resume building in Telegram.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 (adding to the Notifications block — if it didn't
   exist before Prompt 21, you're creating it now).
2. COMPETITIVE_ANALYSIS.md § 3 "Telegram notifications" row.

Block scope:
  ALLOWED to touch:
    - notifier/                               (new container directory)
    - app/dashboard/notifications/page.tsx    (settings UI)
    - app/api/notifications/telegram/**       (new endpoints)
    - prisma/schema.prisma                    (TelegramChat model + relation)
    - docker-compose.yml                      (add notifier service)
    - docs/ARCHITECTURE.md                    (Notifications block row)
    - worker/autoapply/common.py              (ONE LINE: await redis.publish)
  FORBIDDEN to touch:
    - worker/ai/, worker/scrapers/            (unrelated worker blocks)
    - app/dashboard/applications/**, app/dashboard/resumes/** (other blocks)
    - lib/auth.ts, lib/stripe.ts              (Auth + Billing blocks)
    - app/(marketing)/**                      (landing untouched)

═══ TASK ═══

Build a notification-only Telegram bot. Users connect once in dashboard;
after that, they get pings on application events.

═══ Scope (explicitly tiny) ═══

DO:
- Notify on application submitted: "✉️ Applied to <role> at <company>"
- Notify on positive recruiter reply: "📬 Recruiter reply: <company>"
- Notify on LinkedIn auth failure: "⚠️ LinkedIn needs re-auth"
- /start command: single response pointing to dashboard

DO NOT:
- Resume building in Telegram
- Campaign listing in Telegram
- Any other command
- Inline messages or complex keyboards (single "Open dashboard" button is OK)

═══ New block: Notifications ═══

Web side adds:
  app/dashboard/notifications/page.tsx                  # settings + connect
  app/api/notifications/telegram/connect/route.ts       # deep-link generator
  app/api/notifications/telegram/webhook/route.ts       # receives /start

New docker-compose service:
  notifier:
    image: ghcr.io/<owner>/resumeai-notifier:<tag>
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
    depends_on: [postgres, redis]

Notifier subscribes to Redis pub/sub channel `application_events`. Worker
publishes on every ApplicationEvent write (tiny change in
worker/autoapply/common.py — one line). Notifier reads, looks up
TelegramChat, sends message respecting toggles.

═══ Prisma additions ═══

model TelegramChat {
  id           String   @id @default(cuid())
  userId       String   @unique
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  chatId       String
  username     String?
  connectedAt  DateTime @default(now())
  notifyOnSubmit         Boolean @default(true)
  notifyOnInterviewReply Boolean @default(true)
  notifyOnLinkedInIssue  Boolean @default(true)
}

Add `telegramChat TelegramChat?` to User.

═══ Connection flow ═══

1. /dashboard/notifications → "Connect Telegram" button.
2. Server generates short-lived signed JWT (5 min).
3. UI deep link: https://t.me/resumeai_notify_bot?start=<token>
4. User clicks → bot receives /start <token>.
5. Webhook validates token, creates TelegramChat row, replies confirmation.

═══ Steps ═══

1. Create bot via BotFather. Save TELEGRAM_BOT_TOKEN.
2. Register webhook:
       curl -F "url=https://resumeai-bot.ru/api/notifications/telegram/webhook" \
         https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook
3. Build /dashboard/notifications page with toggles + connect button.
4. Build /api/notifications/telegram/connect: POST → JWT + deep link.
5. Build /api/notifications/telegram/webhook: handle /start only. Any other
   text → canned reply pointing to dashboard.
6. Build notifier/ service (Python aiogram 3 OR Node node-telegram-bot-api):
   - Connect to Redis pub/sub on `application_events` channel.
   - On event: fetch user + chat + toggles, send message.
   - Rate-limit: 30 msgs/user/hour. Excess squashed into digest.
7. notifier/templates.py:
   submitted:       "✉️ Applied to {role} at {company}"
   interview_reply: "📬 Recruiter reply at {company} — open dashboard"
   linkedin_issue:  "⚠️ LinkedIn needs re-auth — open dashboard"
   Each with inline button → /dashboard/applications/<id>.
8. Tests:
   - Unit: template rendering.
   - Integration: publish event → notifier sends to mock Telegram endpoint.
   - E2E: real test Telegram account, real event, real message arrives.

═══ Block isolation ═══

Do NOT touch:
- Auth, Billing, Resume domain
- Sender (only one line added: `await redis.publish('application_events', ...)`)
- Dashboard (only adds /dashboard/notifications page)

═══ Acceptance ═══

- Connecting < 30s end-to-end.
- Real application submit → real Telegram message within 10s.
- Toggles work per notification type.
- /stop or dashboard disconnect cleanly removes the chat.

Commit on feat/telegram-notifications, open PR.
```

---

---

## PROMPT 19 — Per-application AI tailoring (resume + cover letter) [Tier 1 P0]

**Run in:** local repo, new branch.
**Goal:** For every autoapply submission, generate a job-specific tailored resume + cover letter using the job description. This is the single biggest feature gap vs Sonara and Massive (`COMPETITIVE_ANALYSIS.md` § 2 row 2, 3). Without this, interview rate stays at baseline.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 rows 3 (Resume domain), 4 (Cover letter), 7 (Sender),
   9 (AI). This prompt touches all four — they are tightly coupled here.
2. COMPETITIVE_ANALYSIS.md § 2 rows 2 and 3 — this is the #1 gap vs Sonara
   and Massive.
3. PMF_FRAMEWORK.md § 1 Test 1 — interview rate is what this is supposed
   to move. Measure it before AND after.

Block scope:
  ALLOWED to touch:
    - worker/ai/tailor.py                     (new)
    - worker/ai/prompts/tailor_resume.txt     (new)
    - worker/ai/prompts/tailor_cover_letter.txt (new)
    - worker/autoapply/common.py              (call tailoring before submit)
    - prisma/schema.prisma                    (JobApplication fields)
    - prisma/migrations/                      (new migration)
    - app/api/applications/[id]/preview/route.ts (new)
    - app/dashboard/applications/[id]/page.tsx (show side-by-side)
    - app/dashboard/settings/automation/page.tsx (toggle)
  FORBIDDEN to touch:
    - worker/scrapers/                        (Scraping block — unrelated)
    - worker/autoapply/linkedin.py, careerops.py (engines — Prompt 16's domain)
    - lib/auth.ts, lib/stripe.ts              (different blocks)
    - extension/, notifier/                   (different blocks)

═══ TASK ═══

Add per-application AI tailoring. Today the worker submits the user's
default resume + a generic cover letter to every job. We're changing this
so each submission gets a resume + cover letter tailored to the specific
job description.

═══ Block scope (per ARCHITECTURE.md) ═══

Touch ONLY:
- Resume domain (web side: add tailored-render endpoint)
- AI block (worker side: new tailoring prompt + function)
- Sender block (worker side: call tailoring before submit)
- Cover letter block (worker side: replace generic with per-job)

Do NOT touch: Auth, Billing, Scraping, Dashboard, Extension, Notifications.

═══ Prisma additions ═══

Add to JobApplication:
   tailoredResume      Json?    // the resume that was actually submitted
   tailoredCoverLetter String?  // the cover letter that was actually submitted
   tailoringTokensUsed Int?     // for cost tracking
   tailoringModelUsed  String?  // e.g. "gpt-4o-mini"

Migration: `npx prisma migrate dev --name per_application_tailoring`.

═══ Worker side ═══

1. Create worker/ai/tailor.py:
       async def tailor_resume(base_resume: dict, job: JobListing) -> dict:
           # Build prompt from worker/ai/prompts/tailor_resume.txt
           # Pass base resume JSON + job title + company + description
           # Return the tailored resume JSON (same shape as base)

       async def tailor_cover_letter(base_resume: dict, job: JobListing) -> str:
           # Build prompt from worker/ai/prompts/tailor_cover_letter.txt
           # Return a 200-300 word cover letter

2. Create worker/ai/prompts/tailor_resume.txt:
       """
       You are tailoring a resume for a specific job application.
       Constraints:
       - Do not invent experience the candidate doesn't have.
       - Reorder bullets so the most relevant ones come first.
       - Adjust wording to match the job description's keywords WHERE TRUTHFUL.
       - Preserve all dates, companies, titles exactly.
       - Output must be valid JSON matching the input schema.

       BASE RESUME:
       {base_resume}

       JOB:
       Title: {job_title}
       Company: {company}
       Description: {description}

       Output tailored resume JSON only.
       """

3. Create worker/ai/prompts/tailor_cover_letter.txt:
       """
       Write a 200-300 word cover letter for this job. Tone: confident,
       specific, no clichés ("I am writing to apply..."). Reference 1-2
       concrete details from the job description and 1-2 from the resume.
       No invented experience.

       RESUME: {base_resume}
       JOB: {job_title} at {company}
       DESCRIPTION: {description}
       """

4. Wire into worker/autoapply/common.py BEFORE each apply call:
       tailored_resume = await tailor_resume(user_base_resume, job)
       cover = await tailor_cover_letter(user_base_resume, job)
       # Pass tailored_resume + cover into the applicator
       # Save both to JobApplication after submit

5. Cache by (resume_id, job_id) hash with TTL 7 days — if same resume
   applies to same job (shouldn't happen but might during retries), reuse
   the tailoring instead of paying OpenAI twice.

6. Cost guardrails:
   - Use gpt-4o-mini (cheapest viable model).
   - If user.planTier = FREE, skip tailoring (use base resume).
   - If user.planTier = TRIAL, tailor only every 3rd application.
   - Pro + Unlimited: tailor every application.
   - Track tailoringTokensUsed; alert if 7-day spend > $50/day.

═══ Web side ═══

1. New endpoint: app/api/applications/[id]/preview/route.ts
   Returns the tailored resume + cover that was submitted for any one
   JobApplication. Used by dashboard for transparency.

2. Dashboard: on application detail page, show side-by-side: "base resume"
   vs "what we submitted". Lets users verify the tailoring isn't doing
   anything weird.

3. Settings: /dashboard/settings/automation toggle "Tailor each application"
   (default ON for Pro+, OFF and locked for Free). When OFF, falls back
   to base resume.

═══ Tests ═══

- Unit: tailor_resume returns valid JSON matching schema for 5 sample inputs.
- Unit: tailor_cover_letter returns 200-300 word string.
- Integration: with a real OpenAI key (test account), tailor against a
  fixture job → resume keyword overlap with job description increases
  vs base resume by ≥30%.
- E2E: campaign runs → 3 applications submitted → each has unique
  tailoredResume + tailoredCoverLetter rows in DB.

═══ Acceptance ═══

- Per-application tailoring runs on Pro + Unlimited tiers only.
- Average cost per tailored application < $0.05 at gpt-4o-mini pricing.
- Dashboard shows the actually-submitted resume for any application.
- Worker logs include tailoring duration + token count per application.
- No regression in submission success rate (Prompt 16 query 1.1 stable).

Commit on feat/per-application-tailoring, open PR.
```

---

## PROMPT 20 — 30-day money-back guarantee + Stripe refund flow [Tier 1 P0]

**Run in:** local repo, new branch.
**Goal:** Replace the paid trial with a no-questions-asked refund within 30 days. Removes the #1 sign-up objection per `COMPETITIVE_ANALYSIS.md` § 5.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 row 2 (Billing).
2. COMPETITIVE_ANALYSIS.md § 5 (pricing) — this is the lever, not the
   pricing change itself.
3. PMF_FRAMEWORK.md § 1 Test 2 (retention exit reasons) — the exit-reason
   modal feeds this.

Block scope:
  ALLOWED to touch:
    - app/api/billing/refund/route.ts         (new)
    - app/api/stripe/webhook/route.ts         (refund event handling)
    - app/(marketing)/pricing/page.tsx        (copy update)
    - app/refund-policy/page.tsx              (new)
    - app/dashboard/billing/page.tsx          (cancel & refund button + modal)
    - lib/pricing.ts                          (remove trial)
    - lib/billing/refund.ts                   (new — eligibility + abuse rules)
    - prisma/schema.prisma                    (User.refundedAt, refundReason)
  FORBIDDEN to touch:
    - worker/                                 (autoapply unchanged)
    - lib/auth.ts                             (Auth block)
    - Resume, Sender, Notifications, Extension blocks

═══ TASK ═══

Replace the $2.99 / 14-day trial with a 30-day money-back guarantee on
Pro and Unlimited subscriptions. Massive uses this at $59/mo and converts
better than Sonara's trial — we'll have the same lever at $19.99.

═══ Block scope ═══

Touch ONLY:
- Billing block (Stripe webhooks, refund logic)
- Marketing site (pricing copy, refund-policy page)
- Dashboard /billing page (cancel & refund button)
- Audit log (record every refund)

Do NOT touch: Auth, Resume, Worker.

═══ Prisma additions ═══

Add to User:
   firstPaidAt      DateTime?  // first time they upgraded from free
   refundedAt       DateTime?  // if they refunded
   refundReason     String?    // free-text from exit modal

Add to AuditLog usage (existing table; just write rows):
   action = "refund_requested" or "refund_processed"

═══ Stripe setup ═══

1. In Stripe Dashboard, no product changes. Just disable the paid trial
   product if it exists.
2. Confirm "Customer creates refunds" is OFF in Stripe (we control via API).

═══ Web side ═══

1. Remove the $2.99 trial from /pricing. Replace with:
       "Try Pro free for 30 days. Cancel anytime — full refund, no questions."
   Show this prominently on the pricing card.

2. Update lib/pricing.ts:
   - Remove "Trial" tier.
   - Keep Free, Pro ($19.99), Unlimited ($29.99) — or apply the price
     bumps from COMPETITIVE_ANALYSIS.md § 5 if you've decided to.

3. Create /refund-policy page with the full terms:
       - Eligible within 30 days of first paid charge.
       - One-time per user (not per renewal).
       - Pro-rata on Unlimited if user has used > 50% of monthly quota.
       - Refund processed within 5 business days.
       - Excludes users flagged for abuse (linked to T&Cs).

4. /dashboard/billing — add a "Cancel & request refund" button (visible
   only if firstPaidAt within last 30 days AND refundedAt is null).
   Click → modal:
       - Required: pick exit reason from fixed list
         (See PMF_FRAMEWORK.md § 1 Test 2):
           "I got a job ✓"
           "Didn't get interviews"
           "Too expensive"
           "Too many low-quality applications were sent"
           "I didn't use it enough"
           "Other (please specify)"
       - Submit → server action.

5. Server action POST /api/billing/refund:
       - Re-check eligibility (within 30d, no prior refund, no abuse flag).
       - Call Stripe API: cancel subscription at_period_end, refund last
         payment in full.
       - Update User: refundedAt = now(), refundReason = exit reason.
       - Write AuditLog row.
       - Email confirmation to user via Resend.
       - Email summary to admin webhook.

6. Stripe webhook handler: on charge.refunded, double-check User state
   matches what we expect (idempotent — refund could happen from either
   side).

═══ Abuse guardrails ═══

- Block refund if user has > 200 applications submitted (likely abuse).
- Block refund if user has previously refunded (one per email lifetime).
- Block refund if user signed up < 1 hour ago and already submitted no
  applications (likely fraud).
- Each blocked attempt writes AuditLog with action = "refund_blocked"
  and reason. Admin reviews weekly.

═══ Tests ═══

- Unit: eligibility check covers all 4 abuse cases.
- Integration: mock Stripe; full refund flow updates DB correctly.
- E2E (Stripe test mode): pay → cancel & refund → Stripe shows refund →
  user.refundedAt set → user can no longer access Pro features at
  period end.

═══ Acceptance ═══

- /pricing visibly advertises "30-day money-back guarantee."
- Refund button works end-to-end in Stripe test mode.
- Exit reasons captured for every cancellation (Prompt 15 G7).
- Refund rate visible on PMF dashboard (Prompt 23).
- Abuse cases blocked AND logged.

Commit on feat/money-back-guarantee, open PR.
```

---

## PROMPT 21 — Daily digest email [Tier 1 P0]

**Run in:** local repo, new branch.
**Goal:** Send paying users a daily summary email of activity. Biggest retention lever per `PMF_FRAMEWORK.md`.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 — you are CREATING the Notifications block here.
   Add the row to the table in the same PR (alongside lib/notifications/).
2. PMF_FRAMEWORK.md § 1 Test 2 (retention) — digest is the lever; measure
   D30 retention before and after launch.

Block scope:
  ALLOWED to touch:
    - lib/notifications/digest.ts             (new)
    - lib/notifications/templates/            (new — React Email templates)
    - app/api/cron/daily-digest/route.ts      (new)
    - app/dashboard/settings/notifications/page.tsx (new — toggle)
    - .github/workflows/digest.yml            (new — hourly cron)
    - prisma/schema.prisma                    (User.dailyDigestEnabled, timezone)
    - docs/ARCHITECTURE.md                    (add Notifications block row)
  FORBIDDEN to touch:
    - worker/                                 (worker doesn't send emails)
    - app/dashboard/applications/**, app/dashboard/resumes/** (other blocks)
    - lib/stripe.ts, lib/auth.ts              (Billing + Auth blocks)
    - extension/                              (Extension block — different feature)

═══ TASK ═══

Build a daily digest email. Sent each morning to every paying user with
applications-sent and recruiter-replies in the last 24h.

═══ Block scope ═══

This is the NEW Notifications block (mentioned in ARCHITECTURE.md § 2 row
as needed). Touch ONLY:
- Notifications (new lib/notifications/digest.ts + email template)
- Cron / scheduled job (new GitHub Actions or VPS cron entry)

Do NOT touch: Worker, Sender, Resume, Billing, Dashboard.

═══ Email content ═══

Subject: "ResumeAI · 7 applications sent yesterday, 2 replies"
Body (HTML, plain text fallback):

   Hi [Name],
   Here's your daily ResumeAI summary.

   Yesterday (Apr 14):
   ✉️ 7 applications sent
        - Senior Backend Engineer at Acme (LinkedIn)
        - DevOps Lead at Stripe (CareerOps)
        - ... [up to 5 examples, "and 2 more" if >5]

   📬 2 recruiter replies
        - Sarah at Acme — interview request → Reply on the dashboard
        - Mike at Stripe — clarifying question → Reply on the dashboard

   📊 Last 7 days: 49 applications, 8 replies (16% interview rate)

   [Open dashboard CTA button]

   --
   You're receiving this because you have an active ResumeAI Pro
   subscription. Mute daily digests in Settings.

═══ Implementation ═══

1. Create lib/notifications/digest.ts:
       export async function generateDigest(userId: string): Promise<DigestData | null>
   Returns null if user had zero activity yesterday — we don't email those
   users; reduces unsubscribes.

2. Create lib/notifications/templates/daily-digest.tsx — React Email template.

3. Create app/api/cron/daily-digest/route.ts (POST, requires CRON_SECRET
   header):
       - Find all User where planTier IN (PRO, UNLIMITED)
       - AND user.dailyDigestEnabled = true (default true; toggle in settings)
       - AND user.timezone set (default UTC)
       - Only send to users where their local time is between 7-9 AM
         (so digest arrives during morning routine, not 3 AM).
       - For each: generateDigest → if not null → Resend.send.
       - Track in AuditLog: action = "daily_digest_sent"

4. Add to Prisma User:
       dailyDigestEnabled Boolean @default(true)
       timezone           String  @default("UTC")
       (timezone is set on first login via browser Intl.DateTimeFormat)

5. Cron: GitHub Actions scheduled workflow `digest.yml` runs every hour
   on the hour (`0 * * * *`), POSTs to /api/cron/daily-digest with
   CRON_SECRET. The endpoint figures out which users to send to based
   on timezone. (Simpler than per-timezone crons.)

6. Settings page: /dashboard/settings/notifications adds toggle "Daily
   digest email" with description "We'll email you once a day with
   yesterday's activity. Sent in the morning your local time."

7. Unsubscribe link in every email → flips dailyDigestEnabled = false
   without requiring login.

═══ Anti-spam ═══

- If user has zero applications submitted yesterday, do NOT send
  (skip-empty-day rule).
- If user just signed up < 24h ago, skip (no data to show).
- If user has unsubscribed, never send.
- Resend dashboard: confirm bounce rate < 2%, complaint rate < 0.1%.

═══ Tests ═══

- Unit: generateDigest returns expected shape for sample DB state.
- Unit: skip-empty-day returns null correctly.
- Integration: cron endpoint with mocked Resend → correct number of sends
  for a seeded DB.
- E2E: with one real test user + one real send, verify the email arrives
  and renders correctly in Gmail + Outlook.

═══ Acceptance ═══

- Toggle on/off in settings works.
- Email arrives within 2h of user's local 8 AM.
- No emails sent to users with zero yesterday-activity.
- Unsubscribe link works without login.
- Bounce + complaint rates within Resend's healthy bands.

Commit on feat/daily-digest, open PR.
```

---

## PROMPT 22 — Job-email inbox (Massive's flagship feature) [Tier 1 P1]

**Run in:** local repo, new branch.
**Goal:** Each user gets a forwarding alias like `<handle>@inbox.resumeai-bot.ru`. Recruiter replies land in a unified inbox on the dashboard, separate from their personal email. This is what Massive charges $59/mo for; you can charge $24.99 and still match it.

```text
═══ REQUIRED READING ═══
1. ARCHITECTURE.md § 2 — Notifications block (created in Prompt 21);
   you're extending it. Auth block (handle minting). AI block (inbound
   classification).
2. COMPETITIVE_ANALYSIS.md § 2 row 9 — this is Massive's flagship feature.
3. PMF_FRAMEWORK.md § 1 Test 1 — interview classification from this inbox
   feeds the interview-rate metric. Critical dependency for Prompt 16.

Block scope:
  ALLOWED to touch:
    - app/api/inbox/inbound/route.ts          (new — Resend inbound webhook)
    - app/dashboard/inbox/                    (new — thread view UI)
    - lib/inbox/                              (new — classification, threading)
    - lib/auth/handle-mint.ts                 (new — generate inboxHandle on signup)
    - lib/auth.ts                             (only to call mint on first signup)
    - prisma/schema.prisma                    (InboxMessage, User.inboxHandle)
    - worker/autoapply/common.py              (ONE LINE: use plus-addressing in reply-to)
    - worker/ai/classify_inbox.py             (new — AI classifier)
  FORBIDDEN to touch:
    - worker/scrapers/, worker/autoapply/<engines>.py (different blocks)
    - lib/stripe.ts                           (Billing block)
    - app/dashboard/resumes/**, app/dashboard/campaigns/** (other dashboards)
    - extension/, notifier/                   (different blocks)

═══ TASK ═══

Build the job-email inbox. Every user gets a forwarding address. Replies
from recruiters land in a unified dashboard inbox, threaded by job
application.

═══ Block scope ═══

Touch ONLY:
- Auth (mint handle on signup)
- Notifications block (inbound email handling)
- Dashboard (new /dashboard/inbox route)
- AI block (classify incoming emails: interview / rejection / question / other)

Do NOT touch: Worker, Sender, Resume, Billing, Extension.

═══ Architecture ═══

Inbound email flow:
1. User signs up → we mint a handle (e.g. "alex-7g3k") and configure
   alex-7g3k@inbox.resumeai-bot.ru as a Resend inbound address.
2. When user creates a JobApplication, the "reply-to" we tell the worker
   to set in the application form is `alex-7g3k+<application_id>@inbox.resumeai-bot.ru`.
   (Or if the form doesn't accept that, use the plain alias and match
   replies by content / company name.)
3. Recruiter replies → Resend webhook fires our endpoint.
4. We classify the email via AI, store as InboxMessage, link to the
   JobApplication, push a notification to the user.

═══ DNS + Resend setup ═══

- Add MX record: inbox.resumeai-bot.ru → mx1.resend.com (or similar).
- Add SPF, DKIM, DMARC per Resend docs.
- In Resend dashboard, enable inbound email for inbox.resumeai-bot.ru.
- Set inbound webhook URL: https://resumeai-bot.ru/api/inbox/inbound.

═══ Prisma additions ═══

Add to User:
   inboxHandle String  @unique  // e.g. "alex-7g3k"

model InboxMessage {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  applicationId String?
  application   JobApplication? @relation(fields: [applicationId], references: [id])
  fromEmail     String
  fromName      String?
  subject       String
  bodyText      String   @db.Text
  bodyHtml      String?  @db.Text
  classification InboxClass @default(UNCLASSIFIED)
  receivedAt    DateTime @default(now())
  isRead        Boolean  @default(false)

  @@index([userId, receivedAt])
}

enum InboxClass {
  INTERVIEW_REQUEST
  REJECTION
  QUESTION
  AUTOMATED
  OTHER
  UNCLASSIFIED
}

═══ Implementation ═══

1. Handle minting on signup:
   - Generate handle from email local-part + 4 random chars to avoid
     collisions (e.g. alex+random4 = "alex-7g3k").
   - Check uniqueness in DB.
   - Store on User.inboxHandle.

2. Sender block tweak (one line in worker/autoapply/common.py):
   When filling reply-to / email field in application forms, use
   `{user.inboxHandle}+{application.id}@inbox.resumeai-bot.ru` if the
   form accepts plus-addressing, else fall back to the plain alias.

3. Inbound webhook handler app/api/inbox/inbound/route.ts:
   - Verify Resend webhook signature.
   - Parse: to, from, subject, body.
   - Extract user from "to" (the part before @).
   - Extract application_id from plus-addressing if present.
   - Save InboxMessage row.
   - Classify with AI (see step 4).
   - If classification = INTERVIEW_REQUEST → write ApplicationEvent
     type='interview_requested' (this feeds Prompt 16's interview-rate
     metric AND Prompt 18's Telegram notification).
   - 200 OK.

4. Classification (worker/ai/classify_inbox.py OR inline in route handler
   via OpenAI):
   Prompt: "Classify this email as one of: INTERVIEW_REQUEST, REJECTION,
   QUESTION, AUTOMATED, OTHER. Output JSON {class, confidence}."
   Skip classification for emails from common auto-responders (regex on
   from address: no-reply@, donotreply@, etc.) → mark AUTOMATED directly.

5. Dashboard inbox /dashboard/inbox:
   - Sidebar: list of conversations grouped by company.
   - Main pane: thread view.
   - Filter chips: All | Interviews | Questions | Rejections.
   - Mark as read on view.
   - Reply button → opens user's default mail client with the recruiter's
     email pre-filled (mailto:) — we don't proxy outbound mail in v1.

6. KPI strip on /dashboard: add "Replies" count next to applications,
   so users see traction at a glance.

═══ Tests ═══

- Unit: handle minting is unique under collision.
- Integration: webhook with mock Resend payload → InboxMessage row +
  ApplicationEvent for interview requests.
- E2E: send a real email to the test user's alias → it appears in
  dashboard inbox within 30s.

═══ Acceptance ═══

- New users get an inboxHandle automatically.
- Recruiter replies land in /dashboard/inbox within 30s of being sent.
- Classification accuracy ≥ 80% on a hand-labeled set of 50 messages.
- Interview-rate metric (Prompt 16, PMF dashboard) now driven by real
  data, not by self-report.

Commit on feat/job-email-inbox, open PR.
```

---

## PROMPT 23 — PMF dashboard + interview-rate survey + exit-reason capture

**Run in:** local repo, new branch.
**Goal:** Implement the measurement system described in `PMF_FRAMEWORK.md`. Without this, you can't tell if Prompts 19–22 actually moved the needle.

```text
═══ REQUIRED READING ═══
1. PMF_FRAMEWORK.md cover to cover. This prompt IS that doc, in code.
2. ARCHITECTURE.md § 2 row 8 (Dashboard / tracking) and row 1 (Auth — for
   admin gate).

Block scope:
  ALLOWED to touch:
    - app/admin/pmf/                          (new — server-component dashboard)
    - app/(dashboard)/layout.tsx              (only to mount survey modal)
    - components/SurveyModal.tsx              (new)
    - app/api/cron/seed-surveys/route.ts      (new — daily cron)
    - .github/workflows/seed-surveys.yml      (new)
    - prisma/schema.prisma                    (Survey model)
    - lib/pmf/                                (new — cohort queries)
  FORBIDDEN to touch:
    - worker/                                 (worker emits the data; doesn't measure)
    - app/dashboard/applications/**, resumes/**, campaigns/** (existing pages)
    - lib/auth.ts                             (read-only — just check session.user.email)
    - lib/stripe.ts                           (Billing — wired to PMF via webhooks already)
    - extension/, notifier/

═══ TASK ═══

Build the PMF measurement system. Three pieces: (a) an admin dashboard
showing the 12 metrics from PMF_FRAMEWORK.md § 2, (b) an in-app survey
that asks users on day-30 "did you get an interview?", (c) exit-reason
capture on cancellation (the modal from Prompt 20 — finish wiring it).

═══ Block scope ═══

Touch ONLY:
- Dashboard / tracking (new /admin/pmf route)
- Auth (admin-email gate)
- Billing (exit-reason already added in Prompt 20 — just ensure persisted)
- New tables: Survey, SurveyResponse

Do NOT touch: Worker, Sender, Resume, Notifications.

═══ Prisma additions ═══

model Survey {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type         String                                 // "interview_day30"
  scheduledFor DateTime
  shownAt      DateTime?
  answeredAt   DateTime?
  response     Json?                                  // structured answers
  @@index([userId, type])
  @@index([scheduledFor, shownAt])
}

═══ /admin/pmf dashboard ═══

Route: app/admin/pmf/page.tsx.
Gate: server-side check that session.user.email IS IN process.env.ADMIN_EMAILS
(comma-separated list).

Layout (matches PMF_FRAMEWORK.md § 2):

   TODAY
     New free signups
     Free → Paid conversions
     Cancellations
     Net new MRR

   LAST 30 DAYS
     Applications submitted
     Submission success rate
     Apps with positive reply (interview rate)
     Apps marked "got job"
     Refunds issued (rate)

   COHORT (paying users who joined 30/60/90 days ago)
     Still subscribed at D30
     Still subscribed at D60
     Still subscribed at D90

   REFERRAL LOOP
     Got-a-job exits this month
     Referral signups from them (coefficient)

Each tile is a server component that runs a Prisma query. Cache for 15
minutes. Show "Last updated" timestamp.

═══ Day-30 interview-rate survey ═══

1. Cron app/api/cron/seed-surveys/route.ts runs daily:
   - Find users whose firstPaidAt was exactly 30 days ago and who have
     no existing Survey row of type "interview_day30".
   - Create Survey rows scheduledFor = now() for them.

2. Middleware in (dashboard) layout — if the logged-in user has a
   Survey with scheduledFor < now() and shownAt is null:
   - Show a modal on next page load:
       "Quick question — did you get any interview requests this month
       from applications we sent?"
       [Yes] [No] [Not sure]
       (Optional follow-up: How many? text input)
   - Save response, set shownAt + answeredAt.
   - Modal dismissable; reopens once after 24h if dismissed.

3. /admin/pmf "interview rate" tile derives from these responses,
   weighted by Inbox classification once Prompt 22 lands. Until then,
   it's just survey-based.

═══ Exit-reason capture (finishes Prompt 20 wiring) ═══

Already added to /dashboard/billing in Prompt 20. Confirm:
- Required field, no free-text-only submissions.
- Stored on User.refundReason.
- Visible in /admin/pmf as a histogram tile "Why people leave (30d)".

═══ Tests ═══

- Unit: cohort query returns correct retention % for seeded data.
- Unit: admin-email gate denies non-admin emails.
- Integration: seed-surveys cron creates Survey rows correctly.
- E2E: as admin, /admin/pmf loads and shows numbers (even if all zero).
- E2E: as a 30-day-old user, modal appears + saves response.

═══ Acceptance ═══

- /admin/pmf renders all 12 metrics within 2s.
- Survey modal fires on day 30 for ≥90% of eligible users.
- Exit-reason histogram shows real distribution.
- Prompt 15 G5/G6/G7 checks all pass on this build.

Commit on feat/pmf-measurement, open PR.
```

---

---

## How to use these prompts

| Order | Prompt | Tier | What it does |
|---|---|---|---|
| 1 | **23** — PMF dashboard + survey | Foundational | Measure first. You can't improve what you can't see. Build BEFORE shipping 19–22 so you have a baseline. |
| 2 | **19** — Per-application AI tailoring | Tier 1 P0 | Closes the quality gap vs Sonara/Massive. Biggest interview-rate lever. |
| 3 | **20** — 30-day money-back guarantee | Tier 1 P0 | Removes #1 sign-up objection. 1-day build. Ship right after 19. |
| 4 | **21** — Daily digest email | Tier 1 P0 | Biggest retention lever per PMF_FRAMEWORK. |
| 5 | **22** — Job-email inbox | Tier 1 P1 | Massive's flagship differentiator. Also unlocks real interview-rate tracking via inbound classification. |
| 6 | **15** — Pre-launch QA | Gate | Run after 19–23 ship. Every line must be ✅ before any paid marketing. |
| 7 | **16** — Autoapply iteration | Weekly | Ongoing. Track both submission AND interview rate (added in this update). |
| 8 | **17** — Chrome extension | Tier 2 P1 | After Tier 1 ships and PMF dashboard shows healthy signals. |
| 9 | **18** — Telegram notifications | Tier 3 P3 | Final polish. Notification-only, not core. |

Read `ARCHITECTURE.md`, `COMPETITIVE_ANALYSIS.md`, and `PMF_FRAMEWORK.md` before running any of these. Each prompt is scoped to specific blocks so changes stay surgical.
