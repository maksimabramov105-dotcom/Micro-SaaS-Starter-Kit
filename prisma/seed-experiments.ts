/**
 * prisma/seed-experiments.ts
 *
 * Seeds initial feature flags and the first 3 experiments.
 * Run with: npx tsx prisma/seed-experiments.ts
 * (or via: npm run db:seed-experiments)
 *
 * All upserts are idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding feature flags...')

  const flags = [
    { key: 'resume_quality_v2',  description: 'STAR/CAR + ATS keyword + self-critique pipeline (Prompt 02)' },
    { key: 'pdf_templates_v1',   description: 'WeasyPrint + Jinja2 template picker (Prompt 03)' },
    { key: 'annual_plans_v1',    description: 'Monthly/yearly pricing toggle (Prompt 05)' },
    { key: 'referral_program_v1',description: 'Referral program (Prompt 07)' },
  ]

  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      create: { key: f.key, enabled: false, rolloutPct: 0, description: f.description },
      update: {}, // never overwrite an existing flag's state on re-seed
    })
    console.log(`  flag: ${f.key}`)
  }

  console.log('\nSeeding experiments...')

  const experiments = [
    {
      key: 'pricing_headline_v1',
      variants: ['control', 'guarantee'],
      weights: [50, 50],
      description:
        'Pricing headline: current copy vs "Land your next job in 30 days or your money back."',
    },
    {
      key: 'free_tier_cap_v1',
      variants: ['three_per_day', 'five_per_day'],
      weights: [50, 50],
      description: 'Free tier daily application cap: 3 vs 5',
    },
    {
      key: 'pro_price_v1',
      variants: ['p1999', 'p2499'],
      weights: [50, 50],
      description: 'Pro monthly price: $19.99 vs $24.99',
    },
  ]

  for (const exp of experiments) {
    await prisma.experiment.upsert({
      where: { key: exp.key },
      create: { ...exp, active: true },
      update: {}, // never reset a running experiment
    })
    console.log(`  experiment: ${exp.key}`)
  }

  console.log('\nSeed complete.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
