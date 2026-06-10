import { test, expect } from '@playwright/test'

/**
 * Regression for the sign-in flake (Prompt 11 P0).
 *
 * We can't drive real Google/GitHub OAuth headlessly, but the user-facing
 * contract we DID fix is testable: when sign-in errors (NextAuth redirects to
 * /login?error=<code>), the user must see a friendly, reassuring message + a
 * working one-click retry — never a raw NextAuth error code or a dead end.
 */

const RAW_CODES = [
  'OAuthCallback',
  'OAuthCreateAccount',
  'OAuthSignin',
  'Callback',
  'OAuthAccountNotLinked',
]

test('error state shows friendly message + working retry, never a raw code', async ({ page }) => {
  await page.goto('/login?error=OAuthCallback')

  const alert = page.getByTestId('signin-error')
  await expect(alert).toBeVisible()
  // Reassures the user this is usually transient and points at the retry.
  await expect(alert).toContainText(/second try|try again/i)

  // The raw NextAuth code must never be shown to the user.
  const body = (await page.locator('body').innerText()).trim()
  for (const code of RAW_CODES) {
    expect(body).not.toContain(code)
  }

  // Retry path: both providers are present and clickable (clicking re-initiates
  // signIn — the actual "retry" for a flaked first attempt).
  await expect(page.getByTestId('signin-google')).toBeEnabled()
  await expect(page.getByTestId('signin-github')).toBeEnabled()
})

test('account-not-linked explains auto-linking on retry', async ({ page }) => {
  await page.goto('/login?error=OAuthAccountNotLinked')
  await expect(page.getByTestId('signin-error')).toContainText(/connect|link/i)
  await expect(page.getByTestId('signin-google')).toBeEnabled()
})

test('clean login (no error) shows no alert', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByTestId('signin-error')).toHaveCount(0)
  await expect(page.getByTestId('signin-google')).toBeVisible()
  await expect(page.getByTestId('signin-github')).toBeVisible()
})
