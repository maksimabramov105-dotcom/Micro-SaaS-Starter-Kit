# ResumeAI — System architecture

> **Purpose of this document:** the canonical map of every block in the system, what each block owns, who depends on whom, and which files live where. Used as the reference for "surgical" changes — when you want to touch one block without breaking the others.
>
> **Status:** Living document. Update when adding or moving blocks. Commit changes here in the same PR as the code change.
>
> **Where this lives:**
> - Source of truth: `docs/ARCHITECTURE.md` in the new GitHub repo (commit it there once you've reviewed it here).
> - Also synced to VPS via every deploy.
> - This `_rebuild-plan/ARCHITECTURE.md` is a working draft on your local machine.

---

## 1. Physical topology (what runs where)

```
┌────────────────────────────────────────────────────────────────┐
│ ONE VPS (Ubuntu 24.04, 4+ GB RAM)                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Caddy (ports 80/443)                                     │  │
│  │ - Auto Let's Encrypt                                     │  │
│  │ - Reverse proxy: /api/worker/* → worker, * → web         │  │
│  └────┬─────────────────────────────────────────────────────┘  │
│       │                                                        │
│  ┌────▼─────────────┐    ┌─────────────────────────┐           │
│  │ web (Next.js)    │◀──▶│ worker (Python FastAPI) │           │
│  │ port 3000        │    │ port 8080 (internal)    │           │
│  └────┬─────────────┘    └──────────┬──────────────┘           │
│       │                             │                          │
│       └──────┬──────────────────────┘                          │
│              ▼                                                 │
│  ┌─────────────────┐   ┌────────────────┐                      │
│  │ postgres:16     │   │ redis:7        │                      │
│  │ persistent vol  │   │ BullMQ + cache │                      │
│  └─────────────────┘   └────────────────┘                      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  External services (over HTTPS):
                  Stripe · OpenAI · Resend · Sentry
                  Adzuna · Arbeitnow · RemoteOK · TheMuse
                  LinkedIn (via headless browser in worker)
```

All 5 containers run via `docker-compose.yml` at `/opt/resumeai/`. The compose file is in GitHub `main`. **If you ever wonder "is X running on the VPS?" — the answer is: if it's not in `docker-compose.yml`, it isn't.**

---

## 2. Logical blocks (surgical units)

The system is built as **9 independent blocks**. Each block has a clearly-scoped responsibility, a fixed surface area on disk, and explicit dependencies on other blocks. When you change a block, you should only touch files listed in that block's "Files" column — anything else means you're reaching across boundaries and should reconsider.

| # | Block | Owns | Files (web side) | Files (worker side) | Depends on |
|---|---|---|---|---|---|
| 1 | **Auth** | Sign-in, sessions, OAuth callbacks | `app/api/auth/[...nextauth]/route.ts`, `lib/auth.ts`, `app/(auth)/signin/page.tsx`, `middleware.ts` | — | DB (User, Account, Session) |
| 2 | **Billing** | Stripe checkout, webhooks, plan tier | `app/api/stripe/**`, `lib/stripe.ts`, `lib/pricing.ts`, `lib/subscription.ts`, `app/dashboard/billing/page.tsx` | — | Auth, DB (User.subscriptionStatus) |
| 3 | **Resume domain** | Resume CRUD, AI generation, preview, PDF | `app/dashboard/resumes/**`, `app/api/resumes/**`, `lib/resume.ts`, `lib/crypto.ts` (for credential encrypt) | `worker/ai/resume.py`, `worker/ai/prompts/resume.txt` | Auth, DB (Resume), AI block |
| 4 | **Cover letter** | One-off + per-application cover letters | `app/api/cover-letters/**` | `worker/ai/cover_letter.py`, `worker/ai/prompts/cover_letter.txt` | Resume domain, AI |
| 5 | **Autoapply campaign** | Campaign CRUD, on/off, daily quota | `app/dashboard/campaigns/**`, `app/api/campaigns/**`, `lib/quota.ts` | `worker/autoapply/__init__.py` (orchestration) | Auth, Billing, Resume, Scraping, Sender |
| 6 | **Scraping** | Pull jobs from boards | — (results read-only via API) | `worker/scrapers/*.py` (adzuna, arbeitnow, remoteok, themuse) | DB (JobListing), external boards |
| 7 | **Sender (autoapply engines)** | Actually submit applications | — | `worker/autoapply/linkedin.py`, `worker/autoapply/careerops.py`, `worker/autoapply/common.py` | Scraping, Resume, Cover letter, AI |
| 8 | **Dashboard / tracking** | Applications table, KPIs, status | `app/dashboard/page.tsx`, `app/dashboard/applications/**`, `app/api/applications/**` | — | DB (JobApplication, ApplicationEvent) |
| 9 | **AI** | Wraps OpenAI/OpenRouter calls, prompt loading, retry/backoff | — | `worker/ai/__init__.py`, `worker/ai/client.py`, `worker/ai/prompts/*.txt` | External (OpenAI) |

Cross-cutting concerns (not blocks, but used by every block):
- **DB schema** — `prisma/schema.prisma`. Single source of truth. Changes here affect every block; require a migration.
- **Worker-bridge** — `lib/worker-client.ts` (web side) and `worker/routes/jobs.py` (worker side). The only way the two halves talk. Bearer-token auth.
- **Audit log** — `lib/audit.ts`. Every mutation in every block should write one row. Forensics + compliance.
- **Observability** — Sentry config files at repo root. Auto-captures errors across all blocks.
- **Quota** — `lib/quota.ts`. Enforces per-plan daily application limits. Called by Sender before every submission.

---

## 3. Block boundary rules (what makes work "surgical")

1. **A block change must touch only files in its row.** If you find yourself editing files in two rows for the same feature, stop and re-plan — you've found a missing block or a leaky abstraction.
2. **DB schema changes are not block-local.** They're a separate change, deployed first, with a migration. The block change comes after.
3. **The worker-bridge is the only inter-half contract.** Web never reaches into the worker's internals; worker never reaches into Next.js. They talk only through `lib/worker-client.ts` ↔ `worker/routes/jobs.py`.
4. **Adding a new block:** add a row to the table above, write the surface (an API route + a worker route if needed), THEN build the implementation. The contract comes first.
5. **Killing a block:** never delete the files; first replace its rows in this doc with `// deprecated`, then remove dependencies one by one, then delete the files in a final dedicated PR.

---

## 4. State stores

| Store | What's in it | Schema source | Backup cadence |
|---|---|---|---|
| Postgres | All persistent data: users, resumes, campaigns, applications, audit | `prisma/schema.prisma` | Nightly `pg_dump` → `/backups/` |
| Redis | BullMQ queues, rate-limit counters, short-lived cache | code (no schema) | None (ephemeral) |
| File system on VPS | Generated PDFs (if `pdfUrl` is local), logs | n/a | Logs rotate via Docker default |
| External: Stripe | Customer, subscription, payment objects | Stripe dashboard | n/a (Stripe is durable) |
| External: OAuth providers | Linked account info (Google/GitHub) | n/a | n/a |

---

## 5. Environment variables — by block

Each env var belongs to exactly one block. If a value needs to be read by two blocks, it's still owned by one of them; the other consumes via that block's helper.

| Block | Env vars |
|---|---|
| Auth | `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `RESEND_API_KEY` (magic links) |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FREE/TRIAL/PRO/UNLIMITED` |
| Resume + Cover + AI | `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) |
| Autoapply campaign | `ENCRYPTION_KEY` (Fernet — for LinkedIn passwords) |
| Scraping | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (board-specific keys) |
| Sender | none unique — uses Resume + AI + Scraping |
| Cross-cutting | `DATABASE_URL`, `REDIS_URL`, `WORKER_URL`, `WORKER_SECRET`, `SENTRY_DSN` |

**Drift rule:** every env var on the VPS must also exist in `.env.production.template` in GitHub. Audited by Prompt 13 step D.

---

## 6. External integrations — failure modes & ownership

| External | Used by | Failure mode | Mitigation |
|---|---|---|---|
| Stripe | Billing | Webhook signature mismatch | Reject + Sentry alert |
| OpenAI | AI | Rate limit / outage | Exponential backoff, fall back to OpenRouter |
| LinkedIn | Sender | Account locked | Mark campaign as `requires_attention`, notify user |
| Adzuna/Arbeitnow/RemoteOK/TheMuse | Scraping | API down | Skip this source for this cycle, continue with others |
| Resend | Auth (magic links) | Outage | Magic links fail; OAuth still works |
| GitHub OAuth / Google OAuth | Auth | Outage | Other provider still works; magic link as fallback |

---

## 7. Where to make changes — quick reference

| You want to... | Block to touch | Files |
|---|---|---|
| Add a new job board | Scraping | New file `worker/scrapers/<board>.py`, register in `worker/scrapers/__init__.py`, add `JobSource.<BOARD>` to Prisma enum |
| Change pricing | Billing | `lib/pricing.ts`, Stripe dashboard, `prisma/schema.prisma` if new tier needs a column |
| Improve resume quality | Resume domain + AI | `worker/ai/prompts/resume.txt`, maybe `worker/ai/resume.py` |
| Add a Chrome extension | New block: Extension | `extension/` directory at repo root; talks to web via `app/api/extension/**` using existing API key system |
| Fix LinkedIn submissions failing | Sender | `worker/autoapply/linkedin.py` only |
| Change what shows on dashboard | Dashboard / tracking | `app/dashboard/page.tsx` + `app/api/applications/**` |
| Add email notifications | Cross-cutting → new block: Notifications | New `lib/notifications/` + worker callback when an application changes state |

If a desired change isn't in this table, add a row before writing code. If you can't describe it in one row, you're trying to change multiple blocks at once — split the work.
