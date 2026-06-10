import { test, expect } from '@playwright/test'

/**
 * End-to-end user-journey gate (Prompt 11). Covers the parts of the
 * landing → sign-in → pay journey that are deterministically testable in CI
 * (no real Google/GitHub OAuth, no real Stripe charges). Authenticated +
 * Stripe-test-mode steps are documented as manual/test-mode checks in
 * docs/qa/journey-audit-2026-06-10.md.
 */

test.describe('Journey', () => {
  test('1. landing loads, has a real CTA, and a clean console', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await page.goto('/')
    await expect(page).toHaveTitle(/ResumeAI/i)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Primary CTA leads somewhere real (login or pricing), not a dead "#".
    const ctas = page.getByRole('link', { name: /get started|start|sign in|try|get my|free/i })
    await expect(ctas.first()).toBeVisible()
    const href = await ctas.first().getAttribute('href')
    expect(href).toBeTruthy()
    expect(href).not.toBe('#')

    // Ignore third-party/analytics noise; fail only on app errors.
    const appErrors = errors.filter(
      (e) => !/analytics|tolt|gtag|favicon|net::ERR|third-party|hydrat/i.test(e),
    )
    expect(appErrors, appErrors.join('\n')).toHaveLength(0)
  })

  test('1b. landing is usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // No horizontal overflow (a common mobile-trust killer).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(2)
  })

  test('2. unauthenticated dashboard redirects to /login (auth gate)', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId('signin-google')).toBeVisible()
  })

  test('5a. pricing page shows the tiers and the guarantee', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.locator('body')).toContainText('Pro')
    await expect(page.locator('body')).toContainText('Unlimited')
    await expect(page.locator('body')).toContainText(/30-day money-back|money-back guarantee/i)
  })

  test('5b. choosing a paid plan while logged out routes to sign-in (no dead end)', async ({ page }) => {
    await page.goto('/pricing')
    const subscribe = page.getByRole('button', { name: /subscribe|get|choose|start/i }).first()
    if (await subscribe.count()) {
      await subscribe.click()
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
    }
  })

  test('legal + contact pages load (trust + compliance)', async ({ page }) => {
    for (const path of ['/terms', '/privacy', '/refund-policy', '/contact']) {
      const res = await page.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(page.getByRole('heading').first()).toBeVisible()
    }
  })
})
