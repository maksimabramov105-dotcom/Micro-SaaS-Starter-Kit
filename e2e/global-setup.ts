/**
 * Playwright global setup — test-auth harness.
 *
 * Lets the authenticated journey specs run without real Google/GitHub OAuth:
 *   1. seed a deterministic test user + resume in the DB (Prisma),
 *   2. mint a NextAuth JWT session token (same encode + NEXTAUTH_SECRET the app
 *      verifies with getToken), and
 *   3. write it as a Playwright storageState cookie.
 *
 * Only used for the LOCAL/CI app (skipped when PLAYWRIGHT_BASE_URL targets prod —
 * see playwright.config.ts). Cookie is non-secure because CI serves over http
 * (NEXTAUTH_URL=http://localhost:3000 → getToken reads `next-auth.session-token`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

export const TEST_USER = {
  email: 'e2e-journey@test.local',
  name: 'E2E Tester',
}

async function globalSetup() {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET required for e2e auth setup')

  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.upsert({
      where: { email: TEST_USER.email },
      update: { name: TEST_USER.name },
      create: { email: TEST_USER.email, name: TEST_USER.name },
    })

    // Seed a resume so /dashboard/resumes and campaign creation have something
    // to work with (and the contact data the worker would use).
    const hasResume = await prisma.resume.findFirst({ where: { userId: user.id } })
    if (!hasResume) {
      await prisma.resume.create({
        data: {
          userId: user.id,
          title: 'E2E Resume',
          targetRole: 'Customer Support Specialist',
          input: { fullName: TEST_USER.name, email: TEST_USER.email, phone: '+64211234567', location: 'New Zealand', yearsExp: '3' },
          generated: { resume_text: 'Experienced customer support specialist.' },
          isDefault: true,
        },
      })
    }

    // Mint the session JWT exactly as NextAuth would (sub = user id).
    const token = await encode({
      token: { name: user.name, email: user.email, sub: user.id },
      secret,
    })

    const storageState = {
      cookies: [
        {
          name: 'next-auth.session-token',
          value: token,
          domain: 'localhost',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    }

    const dir = path.join(process.cwd(), 'e2e', '.auth')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'user.json'), JSON.stringify(storageState, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

export default globalSetup
