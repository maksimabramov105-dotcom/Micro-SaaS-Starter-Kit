import { test, expect } from '@playwright/test'

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/ResumeAI/i)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('pricing page displays plans', async ({ page }) => {
  await page.goto('/pricing')
  // Plan tiers are present (copy-resilient).
  await expect(page.locator('body')).toContainText('Pro')
  await expect(page.locator('body')).toContainText('Free')
})

test('login page loads', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /sign in or create/i })).toBeVisible()
  await expect(page.getByTestId('signin-google')).toBeVisible()
  await expect(page.getByTestId('signin-github')).toBeVisible()
})
