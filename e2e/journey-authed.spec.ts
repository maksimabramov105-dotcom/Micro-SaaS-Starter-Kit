import { test, expect } from '@playwright/test'

/**
 * Authenticated journey steps (Prompt 11 steps 2–4) using the test-auth harness
 * (e2e/global-setup.ts seeds a user + resume and mints a session cookie).
 * Runs against the local/CI app only — never prod.
 */
test.use({ storageState: 'e2e/.auth/user.json' })

test('2. signed-in user reaches the dashboard (no redirect to /login)', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()
})

test('2b. dashboard has a clear next step, and first campaign is ≤5 clicks away', async ({ page }) => {
  await page.goto('/dashboard')

  // The next-step CTA toward creating a campaign must be visible (no dead end).
  const cta = page.getByRole('link', { name: /campaign/i }).first()
  await expect(cta).toBeVisible()

  // Measure clicks-to-first-campaign: follow the CTA to the creation form.
  let clicks = 0
  await cta.click()
  clicks++
  await expect(page).toHaveURL(/\/dashboard\/campaigns\/new/)
  // The creation form is present (an input/select to fill), so the user can act.
  await expect(page.locator('form, input, select, textarea').first()).toBeVisible()

  expect(clicks, `clicks-to-first-campaign was ${clicks}`).toBeLessThanOrEqual(5)
})

test('3. resume creation page renders for a signed-in user', async ({ page }) => {
  await page.goto('/dashboard/resumes/new')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('form, input, select, textarea').first()).toBeVisible()
})

test('4. campaign creation page renders a form', async ({ page }) => {
  await page.goto('/dashboard/campaigns/new')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('form, input, select, textarea').first()).toBeVisible()
})
