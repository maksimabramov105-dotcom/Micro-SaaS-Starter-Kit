import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'
import { TEST_USER } from './global-setup'

/**
 * Journey steps 5 (payment) + 6 (inbox), exercised with REAL signature schemes
 * and the Stripe test key — no real charges. Needs CI secrets:
 *   STRIPE_SECRET_KEY (sk_test_…), RESEND_WEBHOOK_SECRET (whsec_…).
 */
const INBOX_DOMAIN = process.env.INBOX_DOMAIN ?? 'inbox.resumeai-bot.ru'

// ── 5 · Stripe webhook signature gate (money-path entry) ────────────────────
test('Stripe webhook: rejects unsigned, accepts validly-signed', async ({ request }) => {
  const payload = JSON.stringify({
    id: 'evt_e2e_journey', object: 'event', type: 'payment_intent.created',
    data: { object: { id: 'pi_e2e' } },
  })

  const unsigned = await request.post('/api/webhooks/stripe', {
    data: payload, headers: { 'content-type': 'application/json' },
  })
  expect(unsigned.status()).toBe(400)

  const stripe = new Stripe('sk_test_local_only', { apiVersion: '2023-10-16' })
  const sig = stripe.webhooks.generateTestHeaderString({
    payload, secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  const signed = await request.post('/api/webhooks/stripe', {
    data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig },
  })
  expect(signed.status()).toBe(200)
})

// ── 5 · the Stripe test key actually works end-to-end (test-mode checkout) ──
test('Stripe test key creates a checkout session (test mode)', async () => {
  const key = process.env.STRIPE_SECRET_KEY
  // `sk_test_ci` is the CI placeholder used when secrets aren't available
  // (e.g. dependabot / fork pull_request events). It starts with sk_test but is
  // NOT a real key, so skip it — otherwise the live checkout call fails with
  // "Invalid API Key" and reds the whole journey job on every secret-less run.
  test.skip(!key || !key.startsWith('sk_test') || key === 'sk_test_ci', 'requires a real Stripe test key')
  const stripe = new Stripe(key!, { apiVersion: '2023-10-16' })
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' },
        product_data: { name: 'E2E test plan' },
      },
    }],
    success_url: 'https://example.com/s', cancel_url: 'https://example.com/c',
  })
  expect(session.url).toContain('stripe.com')
})

// ── 6 · Resend inbound (signed) → classified inbox message for the user ─────
test('Resend inbound: signed webhook creates an inbox message for the user', async ({ request }) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  test.skip(!secret, 'requires RESEND_WEBHOOK_SECRET')

  const body = JSON.stringify({
    type: 'email.received',
    data: {
      id: 'e2e-inbound-1',
      from: 'Recruiter <recruiter@acme-co.example>',
      to: [`${TEST_USER.inboxHandle}@${INBOX_DOMAIN}`],
      subject: 'Interview request — your application',
      text: 'Thanks for applying! We would like to schedule an interview next week.',
    },
  })
  const id = 'msg_e2e_1'
  const ts = Math.floor(Date.now() / 1000).toString()
  const secretBytes = Buffer.from(secret!.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')

  const res = await request.post('/api/inbox/inbound', {
    data: body,
    headers: {
      'content-type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${expected}`,
    },
  })
  expect(res.status()).toBe(200)
  const json = await res.json()
  expect(json.skipped, `inbound was skipped: ${json.skipped}`).toBeUndefined()

  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.findUnique({ where: { email: TEST_USER.email } })
    const msg = await prisma.inboxMessage.findFirst({
      where: { userId: user!.id, subject: { contains: 'Interview request' } },
      orderBy: { receivedAt: 'desc' },
    })
    expect(msg, 'inbox message was not persisted').toBeTruthy()
  } finally {
    await prisma.$disconnect()
  }
})

// ── 5 · authed checkout endpoint never crashes (handled URL or error) ───────
test.describe('authed checkout', () => {
  test.use({ storageState: 'e2e/.auth/user.json' })
  test('create-checkout-session returns a Stripe URL or a handled error (no 500)', async ({ page }) => {
    const res = await page.request.post('/api/stripe/create-checkout-session', {
      data: { planId: 'pro', interval: 'month' },
    })
    expect(res.status(), 'must not be a 500 crash').not.toBe(500)
    if (res.ok()) {
      const json = await res.json()
      expect(json.url).toContain('stripe.com')
    }
  })
})
