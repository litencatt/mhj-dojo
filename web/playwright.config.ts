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
//
// The server is `go run` unless MHJDOJO_BIN names a built mhj-dojo (CI does,
// and `make e2e` builds one): go run compiles inside the start-up wait, which
// is slow on a loaded machine.
const SERVER_ARGS = `--port ${PORT} --host 127.0.0.1 --open=false`;
const SERVER_COMMAND = process.env.MHJDOJO_BIN
  ? `${JSON.stringify(path.resolve(process.env.MHJDOJO_BIN))} ${SERVER_ARGS}`
  : `go run ./cmd/mhj-dojo ${SERVER_ARGS}`;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The default (half the cores) is one worker on a 2-vCPU runner, which
  // leaves the tests waiting on the CPU game's playback one after another.
  // Every test starts its own game or session, so two can share the server.
  workers: process.env.CI ? 2 : undefined,
  // The json report lets CI list the tests that passed only on a retry
  // (flaky) as warnings; see ci.yml.
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : 'list',
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
    command: SERVER_COMMAND,
    cwd: path.resolve(__dirname, '..'),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
