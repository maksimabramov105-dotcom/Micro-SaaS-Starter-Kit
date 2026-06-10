import { defineConfig, devices } from '@playwright/test'

// "Local" = the CI/dev app at localhost (seedable DB). Prod smoke (https URL)
// skips DB seeding + the test-auth harness.
const isLocal =
  !process.env.PLAYWRIGHT_BASE_URL || process.env.PLAYWRIGHT_BASE_URL.includes('localhost')

export default defineConfig({
  testDir: './e2e',
  // Seeds a test user + mints a session cookie (e2e/.auth/user.json) for the
  // authenticated journey specs. Skipped for prod smoke.
  globalSetup: isLocal ? './e2e/global-setup.ts' : undefined,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // Override to run the public, non-destructive specs against any environment,
    // e.g. PLAYWRIGHT_BASE_URL=https://resumeai-bot.ru. CI uses the local compose
    // app at :3000 (default).
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // When targeting an external URL (prod smoke), don't spin up a local server.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
})
