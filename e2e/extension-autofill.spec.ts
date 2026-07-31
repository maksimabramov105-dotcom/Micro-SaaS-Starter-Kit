/**
 * P2.6 — extension autofill correctness against real ATS form shapes.
 *
 * WHY NOT load the unpacked extension: Playwright can do it, but it forces a
 * persistent Chromium context, disables parallelism and is the flakiest thing in
 * a CI suite. What actually regresses here is the per-ATS SELECTOR MAP in
 * extension/content/autofill.js — Greenhouse renames a field, Ashby changes a
 * data-field-id, and autofill silently stops filling that box with no error
 * anywhere. So these specs load the same content script into a fixture page and
 * drive it through its real entry point (the `resumeai:fill` event), which
 * exercises the selectors exactly as production does, deterministically.
 *
 * Fixtures live in e2e/fixtures/*.html and mirror real form markup.
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN: autofill.js always runs fillGeneric()
 * as a supplement after the ATS-specific filler (autofill.js "Always attempt
 * generic fill as a supplement"). So a field the generic filler can also reach —
 * anything matched by input[type=email], input[type=tel] or a common
 * placeholder — will still be filled even if the ATS-specific selector breaks.
 * Verified by mutation: renaming Ashby's email selector did NOT fail these
 * specs, but renaming its firstName selector DID, because the Ashby fixture's
 * name inputs carry only data-field-id. The assertions that actually protect
 * each selector map are therefore the ones on fields with no generic fallback:
 * Greenhouse's bracketed LinkedIn answer field, Lever's single `name` and
 * urls[...] inputs, and Ashby's firstName/lastName/linkedin/location.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'

const AUTOFILL_JS = readFileSync(
  path.resolve(__dirname, '../extension/content/autofill.js'),
  'utf8',
)
const DETECT_JS = readFileSync(
  path.resolve(__dirname, '../extension/content/detect.js'),
  'utf8',
)

const RESUME = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+61400000000',
  location: 'Sydney, AU',
  linkedinUrl: 'https://linkedin.com/in/ada',
  websiteUrl: 'https://ada.dev',
  currentCompany: 'Analytical Engines',
  currentTitle: 'Platform Engineer',
  experienceYears: '8',
  summary: 'Platform engineer with 8 years running Kubernetes and Terraform.',
}

/** Load a fixture, inject the real content scripts, run the fill, return page. */
async function runAutofill(page: import('@playwright/test').Page, fixture: string) {
  await page.goto(`file://${path.resolve(__dirname, 'fixtures', fixture)}`)
  // detect.js sets window.__resumeai_ats from the URL. A file:// URL has no ATS
  // in it, so force the value the way the real page would have it.
  const ats = fixture.replace('.html', '')
  await page.addScriptTag({ content: DETECT_JS })
  await page.evaluate((a) => {
    ;(window as unknown as Record<string, unknown>).__resumeai_ats = a
  }, ats)
  await page.addScriptTag({ content: AUTOFILL_JS })
  await page.evaluate((resumeData) => {
    document.dispatchEvent(new CustomEvent('resumeai:fill', { detail: { resumeData } }))
  }, RESUME)
  await page.waitForTimeout(200)
  return page
}

test.describe('extension autofill — per-ATS selector maps', () => {
  test('Greenhouse: fills split name, contact, LinkedIn and cover letter', async ({ page }) => {
    await runAutofill(page, 'greenhouse.html')
    await expect(page.locator('#first_name')).toHaveValue('Ada')
    await expect(page.locator('#last_name')).toHaveValue('Lovelace')
    await expect(page.locator('#email')).toHaveValue('ada@example.com')
    await expect(page.locator('#phone')).toHaveValue('+61400000000')
    await expect(
      page.locator('input[name="job_application[answers_attributes][0][text_value]"]'),
    ).toHaveValue('https://linkedin.com/in/ada')
    await expect(page.locator('#cover_letter')).toHaveValue(RESUME.summary)
  })

  test('Lever: fills the SINGLE name field and bracketed url inputs', async ({ page }) => {
    await runAutofill(page, 'lever.html')
    // Lever's one-field name is the classic regression: a Greenhouse-shaped
    // filler would leave this empty.
    await expect(page.locator('input[name="name"]')).toHaveValue('Ada Lovelace')
    await expect(page.locator('input[name="email"]')).toHaveValue('ada@example.com')
    await expect(page.locator('input[name="org"]')).toHaveValue('Analytical Engines')
    await expect(page.locator('input[name="urls[LinkedIn]"]')).toHaveValue(
      'https://linkedin.com/in/ada',
    )
    await expect(page.locator('textarea[name="comments"]')).toHaveValue(RESUME.summary)
  })

  test('Ashby: fills via data-field-id, not name/id', async ({ page }) => {
    await runAutofill(page, 'ashby.html')
    await expect(page.locator('[data-field-id="firstName"]')).toHaveValue('Ada')
    await expect(page.locator('[data-field-id="lastName"]')).toHaveValue('Lovelace')
    await expect(page.locator('[data-field-id="email"]')).toHaveValue('ada@example.com')
    await expect(page.locator('[data-field-id="phone"]')).toHaveValue('+61400000000')
    await expect(page.locator('[data-field-id="location"]')).toHaveValue('Sydney, AU')
  })

  test('signals completion so the overlay can show a result', async ({ page }) => {
    await page.goto(`file://${path.resolve(__dirname, 'fixtures', 'greenhouse.html')}`)
    await page.addScriptTag({ content: DETECT_JS })
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__resumeai_ats = 'greenhouse'
      ;(window as unknown as Record<string, unknown>).__fillDone = null
      document.addEventListener('resumeai:fill_done', (e) => {
        ;(window as unknown as Record<string, unknown>).__fillDone = (e as CustomEvent).detail
      })
    })
    await page.addScriptTag({ content: AUTOFILL_JS })
    await page.evaluate((resumeData) => {
      document.dispatchEvent(new CustomEvent('resumeai:fill', { detail: { resumeData } }))
    }, RESUME)
    await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__fillDone !== null)
    const detail = await page.evaluate(() => (window as unknown as Record<string, unknown>).__fillDone)
    expect(detail).toMatchObject({ ok: true, ats: 'greenhouse' })
  })
})

test.describe('extension job extraction — feeds the Tailor button', () => {
  test('reads title/company/description from JSON-LD JobPosting', async ({ page }) => {
    await page.goto(`file://${path.resolve(__dirname, 'fixtures', 'greenhouse.html')}`)
    await page.addScriptTag({ content: DETECT_JS })
    const job = await page.evaluate(() => (window as unknown as Record<string, unknown>).__resumeai_job)
    expect(job).toMatchObject({ title: 'Senior Platform Engineer', company: 'Acme Corp' })
    expect((job as { description: string }).description).toContain('Kubernetes')
  })

  test('falls back to og: tags when there is no JSON-LD', async ({ page }) => {
    await page.goto(`file://${path.resolve(__dirname, 'fixtures', 'lever.html')}`)
    await page.addScriptTag({ content: DETECT_JS })
    const job = await page.evaluate(() => (window as unknown as Record<string, unknown>).__resumeai_job)
    expect(job).toMatchObject({ title: 'Backend Engineer', company: 'Globex' })
  })
})
