/**
 * One-time fix: set dailyApplicationLimit = 25 (Pro plan) for user
 * cmpffnodl0000of0fo3a00uhn whose limit was stuck at the Free plan
 * default (3/day) despite having active CAREEROPS campaigns.
 *
 * Run inside the web container on the VPS:
 *   docker compose exec web node scripts/fix-user-quota.mjs
 *
 * Or locally with DATABASE_URL set:
 *   DATABASE_URL=... node scripts/fix-user-quota.mjs
 */
import { PrismaClient } from '@prisma/client'

const USER_ID = 'cmpffnodl0000of0fo3a00uhn'
const NEW_LIMIT = 25  // Pro plan

const prisma = new PrismaClient()

const before = await prisma.user.findUnique({
  where: { id: USER_ID },
  select: { id: true, email: true, dailyApplicationLimit: true, stripePriceId: true },
})

if (!before) {
  console.error(`User ${USER_ID} not found`)
  process.exit(1)
}

console.log('Before:', before)

const after = await prisma.user.update({
  where: { id: USER_ID },
  data: { dailyApplicationLimit: NEW_LIMIT },
  select: { id: true, email: true, dailyApplicationLimit: true },
})

console.log('After: ', after)
await prisma.$disconnect()
