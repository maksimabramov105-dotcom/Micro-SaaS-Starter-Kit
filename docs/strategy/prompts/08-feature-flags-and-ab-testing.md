# Prompt 08 — Feature flags + lightweight A/B testing harness

> **Paste into Claude Code. Foundational infrastructure for safely rolling out and measuring everything else. Small, surgical, no new external dependency.**
>
> ⚠️ **READ FIRST: `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.6.** `lib/analytics.ts` AND `lib/analytics-advanced.ts` already exist — do NOT overwrite. Add a new `lib/experiments.ts` and integrate with the existing `AnalyticsEvent` Prisma model by adding `experiment_key` and `variant` into the existing `properties` JSON field.
>
> 🚨 **VPS hard-fail:** end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why
Per `docs/strategy/STRATEGIC_ANALYSIS.md` §6.4 and §6.6:
- You cannot ship resume quality v2, PDF templates, annual pricing, or referral safely without flags
- You cannot decide pricing or copy on vibes — A/B tests are the only honest way to learn
- Stage 1 is in-house (zero dependency). Stage 2 (at $5K MRR) migrates to PostHog free.

This prompt builds Stage 1.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §6.6 — the first 3 experiments
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.6 — DO NOT overwrite existing analytics modules
3. `prisma/schema.prisma` — `AnalyticsEvent` model already exists, reuse it
4. `lib/analytics.ts` AND `lib/analytics-advanced.ts` — already exist; extend, don't replace
5. `lib/auth.ts` — session shape
6. `lib/quota.ts` — example of where feature gates live today
7. `app/pricing/page.tsx` and `components/pricing-cards.tsx` — first A/B target

## Changes

### Change 1 — Schema

Add to `prisma/schema.prisma`:
```prisma
model FeatureFlag {
  key         String   @id
  enabled     Boolean  @default(false)
  rolloutPct  Int      @default(0)        // 0-100
  description String?
  updatedAt   DateTime @updatedAt
}

model Experiment {
  key         String   @id
  active      Boolean  @default(true)
  variants    String[] // e.g. ["control", "treatment"]
  weights     Int[]    // e.g. [50, 50] — must sum to 100
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  description String?
}

model ExperimentAssignment {
  id           String   @id @default(cuid())
  experimentKey String
  userId       String?
  anonId       String?  // for pre-signup visitors (set in cookie)
  variant      String
  assignedAt   DateTime @default(now())

  @@unique([experimentKey, userId])
  @@unique([experimentKey, anonId])
  @@index([experimentKey, variant])
}
```
Migration: `add_feature_flags_and_experiments`.

### Change 2 — Flags library

`lib/flags.ts` (new):
```typescript
import { prisma } from './prisma';
import crypto from 'crypto';

type Cache = { value: Map<string, { enabled: boolean; pct: number }>; loadedAt: number };
let cache: Cache | null = null;
const TTL_MS = 5 * 60 * 1000;

async function load(): Promise<Cache['value']> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.value;
  const rows = await prisma.featureFlag.findMany();
  const v = new Map(rows.map(r => [r.key, { enabled: r.enabled, pct: r.rolloutPct }]));
  cache = { value: v, loadedAt: Date.now() };
  return v;
}

export async function isFlagEnabled(key: string, userId?: string): Promise<boolean> {
  const flags = await load();
  const f = flags.get(key);
  if (!f) return false;
  if (!f.enabled) return false;
  if (f.pct >= 100) return true;
  if (f.pct <= 0) return false;
  if (!userId) return false; // gradual rollout requires stable identity
  const bucket = parseInt(crypto.createHash('sha256').update(`${key}:${userId}`).digest('hex').slice(0, 8), 16) % 100;
  return bucket < f.pct;
}

export function invalidateFlagCache() { cache = null; }
```

Server-side usage:
```typescript
if (await isFlagEnabled('pdf_templates_v1', session.user.id)) { /* new path */ }
```

### Change 3 — Experiments library

`lib/experiments.ts` (new):
```typescript
import { prisma } from './prisma';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const ANON_COOKIE = 'rai_anon';

export async function getOrAssignVariant(experimentKey: string, userId?: string): Promise<string> {
  const exp = await prisma.experiment.findUnique({ where: { key: experimentKey } });
  if (!exp || !exp.active) return 'control';
  const id = userId ?? cookies().get(ANON_COOKIE)?.value;
  if (!id) {
    const newAnon = crypto.randomUUID();
    cookies().set(ANON_COOKIE, newAnon, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    return assignAndSave(exp, undefined, newAnon);
  }
  const existing = await prisma.experimentAssignment.findFirst({
    where: { experimentKey, OR: [{ userId: id }, { anonId: id }] },
  });
  if (existing) return existing.variant;
  return assignAndSave(exp, userId, userId ? undefined : id);
}

async function assignAndSave(
  exp: { key: string; variants: string[]; weights: number[] },
  userId?: string,
  anonId?: string,
): Promise<string> {
  const total = exp.weights.reduce((a, b) => a + b, 0);
  const seed = userId ?? anonId ?? crypto.randomUUID();
  const bucket = parseInt(crypto.createHash('sha256').update(`${exp.key}:${seed}`).digest('hex').slice(0, 8), 16) % total;
  let acc = 0;
  let variant = exp.variants[0];
  for (let i = 0; i < exp.variants.length; i++) {
    acc += exp.weights[i];
    if (bucket < acc) { variant = exp.variants[i]; break; }
  }
  await prisma.experimentAssignment.create({
    data: { experimentKey: exp.key, userId, anonId, variant },
  });
  return variant;
}
```

### Change 4 — Conversion tracking

Reuse the existing `AnalyticsEvent` model. Convention: when reporting an experiment-related conversion, include `properties.experiment_key` and `properties.variant` so analysis later is trivial. Example:
```typescript
await prisma.analyticsEvent.create({
  data: {
    userId: session.user.id,
    event: 'checkout_started',
    properties: {
      plan: 'pro',
      interval: 'year',
      experiment_key: 'pricing_headline_v1',
      variant: assignedVariant,
    },
  },
});
```

Add a helper `lib/analytics.ts`:
```typescript
export async function trackEvent(args: {
  event: string;
  userId?: string;
  anonId?: string;
  properties?: Record<string, unknown>;
}) { /* ... wraps prisma.analyticsEvent.create with try/catch */ }
```

### Change 5 — First 3 experiments — seed them

Add `prisma/seed-experiments.ts`:
```typescript
import { prisma } from '../lib/prisma';

async function main() {
  await prisma.experiment.upsert({
    where: { key: 'pricing_headline_v1' },
    create: {
      key: 'pricing_headline_v1',
      variants: ['control', 'guarantee'],
      weights: [50, 50],
      description: 'Pricing headline: current vs "Land your next job in 30 days or your money back."',
    },
    update: {},
  });
  await prisma.experiment.upsert({
    where: { key: 'free_tier_cap_v1' },
    create: {
      key: 'free_tier_cap_v1',
      variants: ['three_per_day', 'five_per_day'],
      weights: [50, 50],
      description: 'Free tier daily application cap: 3 vs 5',
    },
    update: {},
  });
  await prisma.experiment.upsert({
    where: { key: 'pro_price_v1' },
    create: {
      key: 'pro_price_v1',
      variants: ['p1999', 'p2499'],
      weights: [50, 50],
      description: 'Pro monthly price: $19.99 vs $24.99',
    },
    update: {},
  });
  // Initial flags
  for (const k of ['resume_quality_v2', 'pdf_templates_v1', 'annual_plans_v1', 'referral_program_v1']) {
    await prisma.featureFlag.upsert({
      where: { key: k },
      create: { key: k, enabled: false, rolloutPct: 0, description: `Auto-seeded ${k}` },
      update: {},
    });
  }
}
main();
```

Wire up: in `app/pricing/page.tsx`, use `getOrAssignVariant('pricing_headline_v1', session?.user?.id)` and render different headline copy based on variant. Same pattern for the other two experiments where they live.

### Change 6 — Admin UI (cheap version)

New page `app/admin/flags/page.tsx` (gated to a hardcoded admin email list in env — `ADMIN_EMAILS=adam@...`):
- Table of all flags with toggle + rollout % slider
- Table of all experiments with active toggle + counts of assignments per variant
- "Invalidate cache" button (calls `invalidateFlagCache()`)

Not pretty. Functional. ~150 lines of code. Don't overbuild.

### Change 7 — Quick results script

`scripts/experiment_results.ts`:
```typescript
// Usage: npx tsx scripts/experiment_results.ts pricing_headline_v1
// Outputs: per-variant counts of assignments, signups, checkouts_started, paid_conversions, + simple p-value (Z-test on conversion proportions).
```
This is your "did the experiment win" tool. Run it weekly.

### Change 8 — Tests
- `isFlagEnabled` returns deterministic bucket per (key, userId)
- 50% rollout = ~50% of synthetic user IDs return true (test with 10k synth IDs, tolerance ±2%)
- Variant assignment is sticky for a given userId
- Anonymous user → cookie set → same variant on next call

## Verification
1. Seed experiments locally, visit `/pricing` twice with same browser session — variant is sticky
2. Toggle flag in admin UI, hit `invalidateFlagCache`, verify takes effect immediately
3. Run results script on a synthetic dataset — math checks out

## Deploy
1. Branch `feat/flags-and-experiments`
2. Migrate dev DB, then prod DB (additive only, low risk)
3. Seed experiments + flags via `npx prisma db seed` (configured to run `seed-experiments.ts`)
4. Merge → deploy → smoke test admin UI

## Rules
- Flags default OFF — anything you ship goes behind a flag, you turn it on yourself
- Experiments default INACTIVE in code — explicitly seeded
- Cache TTL 5min — long enough to be cheap, short enough that admin toggles don't feel broken
- Anonymous assignments use a cookie — don't lose anon experiment data if user signs up later (carry the anonId → userId mapping on signup)
- Commit message: `feat(infra): feature flags + A/B experiment harness + seed first 3 experiments`

## Definition of done
- All migrations applied
- Both libraries implemented + tested
- Admin UI live
- All 3 starter experiments active and being assigned
- Results script tested with synthetic data
- `docs/ARCHITECTURE.md` updated with new Flags + Experiments subsystem
- Existing feature flags from prompts 02, 03, 05 wired into the new system (replace ad-hoc env-var checks)
- VPS git HEAD matches GitHub main

## What to do AFTER this is live
1. Turn `pdf_templates_v1` to 100% (full launch)
2. Turn `resume_quality_v2` to 25% rollout, monitor Sentry + analytics for 48h, then 100%
3. Let pricing/free-tier/price experiments run for 14 days, then analyze, then ship the winner
4. Plan next 3 experiments: (a) onboarding screen order, (b) cover-letter-vs-resume-first signup CTA, (c) dashboard empty state copy
