import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// End-to-end tests drive the real server (built assets + Go backend), not
// the Vite dev server: `npm run build` must run first so the server embeds
// the current frontend (internal/server/static/dist). They are e2e/shared,
// which playwright.site.config.ts runs on the static site too, and
// e2e/server, which only means something here (the HTTP API, two browsers
// on one session).
export default defineConfig({
  testDir: './e2e',
  testMatch: ['shared/**/*.spec.ts', 'server/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The default (half the cores) is one worker on a 2-vCPU runner, which
  // leaves the tests waiting on the CPU game's playback one after another.
  // Every test starts its own game or session, so two can share the server.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The build the tests run on (e2e/helpers.ts): 'server' or 'site'.
      name: 'server',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `go run ./cmd/mhj-dojo --port ${PORT} --host 127.0.0.1 --open=false`,
    cwd: path.resolve(__dirname, '..'),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
