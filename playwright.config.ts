import { defineConfig, devices } from '@playwright/test';

// Browser tests (qa lane). Each run starts its own server on E2E_PORT (5199 by default; a lane uses its port from
// scripts/lanes.json) and fails rather than reuse whatever else is listening there.
const port = Number(process.env.E2E_PORT ?? 5199);
const baseURL = `http://localhost:${port}`;
const onCi = Boolean(process.env.CI);

// E2E_SERVER=preview builds once and serves dist/ with `vite preview`, the code that ships, with no hot reload: a
// file another lane (or the lead's merge) writes during a run can't reload the page under a test, as the dev server
// does. `npm run lane -- e2e <lane>` sets it. Unset, the tests run on the dev server, which needs no build.
const server = process.env.E2E_SERVER ?? 'dev';
if (server !== 'dev' && server !== 'preview') throw new Error(`E2E_SERVER must be dev or preview, not "${server}"`);
const serverCommand =
  server === 'preview'
    ? `npm run build && npx vite preview --port ${port} --strictPort`
    : `npm run dev -- --port ${port} --strictPort`;

// E2E_CHROMIUM points the tests at a Chromium other than the one this Playwright version installs, such as a
// machine's /opt/pw-browsers/chromium when it is newer, without a config of one's own.
const executablePath = process.env.E2E_CHROMIUM || undefined;

// Every test renders the whole grey-box plant in WebGL. Without a GPU (CI runners, the agents' machines)
// Chromium draws it with SwiftShader on the CPU at a few frames a second, and two pages at once halve each
// other's frame rate, so the camera flies and the clock checks crawl. One page at a time by default;
// E2E_WORKERS (or --workers) runs more where a GPU does the drawing.
const workers = Number(process.env.E2E_WORKERS ?? 1);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: onCi,
  retries: onCi ? 1 : 0,
  workers,
  // Software GL makes every click and check cost a frame or more (a few hundred ms on a busy runner), so a
  // test of the top bar takes 15–50 s there; twice that leaves room for a slower CI machine. Tests that
  // walk five stages set their own, longer timeout.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    // A trace records screenshots all along, which costs software GL frames in every test; record one only
    // when CI retries a failed test (rerun a local failure with --trace on).
    trace: 'on-first-retry',
    // CI runners have no GPU; recent Chromium only falls back to software WebGL (SwiftShader) with this flag.
    launchOptions: { args: ['--enable-unsafe-swiftshader'], executablePath },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: false,
    // The preview first builds the app (a few seconds, longer on a busy machine).
    timeout: server === 'preview' ? 180_000 : 60_000,
  },
});
