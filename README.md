# ResumeAI

AI-powered job application assistant.

## Stack
- Next.js 16 + TypeScript
- PostgreSQL via Prisma
- NextAuth (Google, GitHub, Email magic link)
- Stripe subscriptions
- Sentry error tracking
- Python FastAPI worker (see `_extracted_worker/`)

## Dev setup
```bash
cp .env.production.template .env.local
# Fill in DATABASE_URL, NEXTAUTH_SECRET, Google/GitHub OAuth, Stripe keys
npm install
npm run db:push
npm run dev
```

## Deploy
Push to main → Vercel auto-deploys. Set env vars in Vercel dashboard.
Python worker is deployed separately as a Docker container.

## Architecture & operations
- System map: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Competitive analysis & roadmap: [`docs/COMPETITIVE_ANALYSIS.md`](docs/COMPETITIVE_ANALYSIS.md)
- PMF measurement: [`docs/PMF_FRAMEWORK.md`](docs/PMF_FRAMEWORK.md)
- Operations prompts (Claude Code playbook): [`docs/OPERATIONS_PROMPTS.md`](docs/OPERATIONS_PROMPTS.md)
- Block ownership (machine-readable): [`docs/blocks.yaml`](docs/blocks.yaml)

Every PR must follow the block-isolation protocol in
`docs/ARCHITECTURE.md` § 3 — CI enforces it via
`.github/workflows/block-isolation.yml`.
