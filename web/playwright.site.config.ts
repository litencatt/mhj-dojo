import { defineConfig, devices } from '@playwright/test';

const PORT = 8798;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// End-to-end tests for the static site (issue #67): the practice engine runs
// as WebAssembly in the browser, with no mhj-dojo server. `make site` must run
// first so web/dist-site is up to date; `vite preview` serves it (with
// .wasm as application/wasm).
export default defineConfig({
  testDir: './e2e-site',
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
      name: 'chromium',
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
