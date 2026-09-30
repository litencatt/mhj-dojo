import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// End-to-end tests on mhj-dojo, which serves the site's build (issue #147):
// `make embed` must run first so the server embeds the current build
// (internal/server/static/dist), a copy of web/dist-site, the files the
// public site deploys.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The default (half the cores) is one worker on a 2-vCPU runner, which
  // leaves the tests waiting on the CPU game's playback one after another.
  // Every test starts its own game or session, so two can share the server.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'site',
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
