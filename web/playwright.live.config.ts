import { defineConfig, devices } from '@playwright/test';

// MHJDOJO_SITE_URL is the same build-time site URL the workflows pass to the
// site build (one place to change when the published host moves); it may
// carry a trailing slash, which baseURL doesn't want. LIVE_BASE_URL still
// overrides it for a local check.
const BASE_URL = process.env.LIVE_BASE_URL ?? (process.env.MHJDOJO_SITE_URL ?? 'https://mhj-dojo.lolipop-now.app/').replace(/\/$/, '');

// A minimal smoke test against the deployed public site (deploy-lolipop.yml's
// post-deploy verification): no webServer, since the target already runs on
// its own.
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
