/**
 * Referral claim guard.
 *
 * #90 swapped the reward from a double-sided $20 credit to "the referrer gets a
 * free month when their friend buys a year of Pro". It updated the mechanics,
 * the referrer email and the dashboard. It did not update /terms or the email
 * the REFERRED user receives, so for six weeks both promised a $20 credit that
 * no code path could grant — the terms of service of a product whose entire
 * pitch is that it does not claim things that did not happen.
 *
 * Every assertion here is about copy agreeing with lib/referral/offer.ts. The
 * mechanics themselves are tested in referral.test.ts.
 */

import { readFileSync } from 'fs'
import path from 'path'

import {
  MAX_REFERRALS,
  CLAWBACK_WINDOW_DAYS,
  QUALIFYING_PLAN_LABEL,
  REFERRAL_FREE_MONTHS,
  freeMonthsLabel,
} from '@/lib/referral/offer'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** Strip comments — a comment explaining the old offer is not a claim. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── The email a referred user receives ───────────────────────────────────────

const mockSendEmail = jest.fn().mockResolvedValue({ success: true })
jest.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => mockSendEmail(...a) }))

const { sendReferralReceivedEmail, sendReferralQualifiedEmail } = require('@/lib/referral/emails')

async function refereeEmail() {
  mockSendEmail.mockClear()
  await sendReferralReceivedEmail({ to: 'new@example.com', refereeName: 'Sam', referrerName: 'Alex' })
  return mockSendEmail.mock.calls[0][0] as { subject: string; html: string }
}

describe('the email sent to a referred user', () => {
  it('promises them no money, credit, discount or gift', async () => {
    const { subject, html } = await refereeEmail()
    const copy = `${subject}\n${html}`

    // A dollar figure aimed at the referee is the exact defect this guards.
    expect(copy).not.toMatch(/\$\d/)
    expect(copy).not.toMatch(/\bcredit\b/i)
    expect(copy).not.toMatch(/\bgift\b/i)
    expect(copy).not.toMatch(/\b\d+% off\b/i)
    // "gave you", "you have ... waiting", "claim your" — the old subject and CTA.
    expect(copy).not.toMatch(/gave you/i)
    expect(copy).not.toMatch(/claim your/i)
  })

  it('names the person who invited them, in the subject', async () => {
    const { subject } = await refereeEmail()
    expect(subject).toContain('Alex')
  })

  it('discloses what the referrer gets, using the canonical label', async () => {
    const { html } = await refereeEmail()
    expect(html).toContain(freeMonthsLabel())
    expect(html).toContain('/terms')
  })

  it('does not race the welcome email to the same call to action', async () => {
    // lib/lifecycle sends the welcome mail seconds earlier and it owns "run the
    // free fit check". Two mails, same minute, same button is why this one has
    // to justify itself on different ground.
    const { html } = await refereeEmail()
    expect(html).not.toContain('/ats-check')
    expect(html).not.toContain('/pricing')
  })

  it('still addresses someone whose name and referrer name are unknown', async () => {
    mockSendEmail.mockClear()
    await sendReferralReceivedEmail({ to: 'x@example.com', refereeName: null, referrerName: null })
    const { subject, html } = mockSendEmail.mock.calls[0][0]
    expect(subject).not.toContain('null')
    expect(html).not.toContain('null')
    expect(subject).toMatch(/^A friend invited you/)
  })
})

// ── The email the referrer receives ──────────────────────────────────────────

describe('the email sent to a referrer', () => {
  it('states the reward as months of Pro, never as dollars', async () => {
    mockSendEmail.mockClear()
    await sendReferralQualifiedEmail({
      to: 'ref@example.com',
      referrerName: 'Alex',
      freeMonths: REFERRAL_FREE_MONTHS,
    })
    const { subject, html } = mockSendEmail.mock.calls[0][0]
    expect(`${subject}\n${html}`).not.toMatch(/\$\d/)
    expect(html).toContain(freeMonthsLabel())
  })
})

// ── The terms of service ─────────────────────────────────────────────────────

describe('/terms section 7', () => {
  const src = stripComments(read('app/terms/page.tsx'))
  const section = src.slice(src.indexOf('7. Referral Program'), src.indexOf('8. Affiliate Program'))

  it('exists and is not empty', () => {
    expect(section.length).toBeGreaterThan(200)
  })

  it('does not describe the retired double-sided credit', () => {
    expect(section).not.toMatch(/double-sided/i)
    expect(section).not.toMatch(/\$\d/)
    expect(section).not.toMatch(/both you and the referred user/i)
  })

  it('says out loud that the referred user gets nothing', () => {
    expect(section).toMatch(/receives no credit or discount/i)
  })

  it('imports its numbers rather than restating them', () => {
    // The literals must not appear as text in the section — they must arrive
    // through the constants, which is what stops the next swap from missing it.
    expect(section).toContain('{MAX_REFERRALS}')
    expect(section).toContain('{CLAWBACK_WINDOW_DAYS}')
    expect(section).toContain('{QUALIFYING_PLAN_LABEL}')
    expect(section).toContain('{freeMonthsLabel()}')
    expect(src).toMatch(/import \{[\s\S]*?\} from '@\/lib\/referral\/offer'/)
  })

  it('the imported values still read the way the page assumes', () => {
    // If someone raises the cap to 25 or the window to 60, the page follows —
    // but a nonsense value (0 referrals, 0 days) would render nonsense prose.
    expect(MAX_REFERRALS).toBeGreaterThan(0)
    expect(CLAWBACK_WINDOW_DAYS).toBeGreaterThan(0)
    expect(QUALIFYING_PLAN_LABEL).toBeTruthy()
    expect(freeMonthsLabel()).toMatch(/free month/)
  })
})

// ── The dashboard ────────────────────────────────────────────────────────────

describe('/dashboard/referrals', () => {
  const src = stripComments(read('app/dashboard/referrals/page.tsx'))

  it('promises the referrer free months, not dollars', () => {
    expect(src).not.toMatch(/\$\d/)
    expect(src).toMatch(/free month/i)
  })

  it('does not tell the sharer their friend gets a discount', () => {
    expect(src).not.toMatch(/\bthey get\b.*\b(credit|discount|off)\b/i)
    expect(src).not.toMatch(/give \$|get \$/i)
  })
})
