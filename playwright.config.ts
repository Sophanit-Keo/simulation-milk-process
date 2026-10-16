import { defineConfig, devices } from '@playwright/test';

// Browser tests (qa lane): the phase 1 smoke tests and the phase 2 G1 flows. Each run starts its own Vite dev server
// on E2E_PORT (5199 by default) and fails rather than reuse whatever else is listening there.
const port = Number(process.env.E2E_PORT ?? 5199);
const baseURL = `http://localhost:${port}`;
const onCi = Boolean(process.env.CI);

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
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
