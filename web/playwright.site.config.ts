import { defineConfig, devices } from '@playwright/test';

const PORT = 8798;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// End-to-end tests for the static site (issue #67): the engine runs
// as WebAssembly in the browser, with no mhj-dojo server. `make site` must run
// first so web/dist-site is up to date; `vite preview` serves it (with
// .wasm as application/wasm). The tests are e2e/shared and e2e/site, which
// playwright.config.ts runs on the same build as mhj-dojo serves it.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['shared/**/*.spec.ts', 'site/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'playwright-report-site' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The build the tests run on (e2e/helpers.ts): 'server' or 'site'.
      name: 'site',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx vite preview --mode site --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
