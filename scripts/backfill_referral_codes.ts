/**
 * scripts/backfill_referral_codes.ts
 *
 * One-off: assign referral codes to all existing users who don't have one.
 *
 * Usage:
 *   npx tsx scripts/backfill_referral_codes.ts
 *
 * Safe to re-run — skips users who already have a code.
 */

import { PrismaClient } from '@prisma/client'
import { customAlphabet } from 'nanoid'

const prisma = new PrismaClient()
const codeAlphabet = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 6)

function buildCode(name: string | null): string {
  const namePart = name
    ? name.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
    : 'user'
  return `${namePart || 'user'}-${codeAlphabet()}`
}

async function main() {
  const users = await prisma.user.findMany({
    where: { referralCode: null },
    select: { id: true, name: true },
  })

  console.log(`Found ${users.length} users without referral codes.`)

  let assigned = 0
  let failed = 0

  for (const user of users) {
    let success = false
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { referralCode: buildCode(user.name) },
        })
        success = true
        break
      } catch {
        // P2002 unique constraint — retry with new code
      }
    }
    if (success) {
      assigned++
    } else {
      console.warn(`  FAILED: could not assign code to user ${user.id} after 5 attempts`)
      failed++
    }
  }

  console.log(`Done. Assigned: ${assigned}, Failed: ${failed}`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
