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
    // Real JS exceptions (pageerror) are always a fail; console "error" entries
    // for resource/network 404s (third-party scripts, OG image, fonts in CI) are
    // not — those don't break the page for the user.
    const jsErrors: string[] = []
    page.on('pageerror', (e) => jsErrors.push(String(e)))

    await page.goto('/')
    await expect(page).toHaveTitle(/ResumeAI/i)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Primary CTA leads somewhere real (login or pricing), not a dead "#".
    const ctas = page.getByRole('link', { name: /get started|start|sign in|try|get my|free/i })
    await expect(ctas.first()).toBeVisible()
    const href = await ctas.first().getAttribute('href')
    expect(href).toBeTruthy()
    expect(href).not.toBe('#')

    expect(jsErrors, jsErrors.join('\n')).toHaveLength(0)
  })

  /**
   * This check used to cover '/' only — so /resume-rescue, the page that takes
   * the $4.99, scrolled sideways on every phone 410px and under without anything
   * noticing. Same shape as #214: a guard that covered one of the routes it was
   * described as covering. It now covers every page a stranger can reach on the
   * way to paying, and the fix belongs in the page, never in the assertion.
   */
  for (const path of ['/', '/ats-check', '/resume-rescue', '/pricing']) {
    test(`1b. ${path} is usable on a mobile viewport (390x844)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // No horizontal overflow (a common mobile-trust killer).
      const { overflow, widest } = await page.evaluate(() => {
        const de = document.documentElement
        // Name the widest offender — "overflow: 29" alone starts a bisect.
        const widest = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 2)
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`)[0]
        return { overflow: de.scrollWidth - de.clientWidth, widest: widest ?? '' }
      })
      expect(overflow, `${path} overflows by ${overflow}px — widest: ${widest}`).toBeLessThanOrEqual(2)
    })
  }

  test('2. unauthenticated dashboard redirects to /login (auth gate)', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId('signin-google')).toBeVisible()
  })

  test('5a. pricing page shows the tiers and the guarantee', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.locator('body')).toContainText('Pro')
    // Unlimited tier is hidden until demand exists (Revenue Sprint A1)
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
