import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.LIVE_BASE_URL ?? 'https://mhj-dojo.lolipop-now.app';

// A minimal smoke test against the deployed public site (release-site.yml's
// post-deploy verification): no webServer, since the target already runs on
// its own. LIVE_BASE_URL points elsewhere for a local check.
export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'playwright-report-live' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
