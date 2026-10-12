import { defineConfig, devices } from '@playwright/test';

// Browser smoke tests (plan/agent-plan/phase-1-setup.md, qa lane). Each run starts its own Vite dev server
// on E2E_PORT (5199 by default) and fails rather than reuse whatever else is listening there.
const port = Number(process.env.E2E_PORT ?? 5199);
const baseURL = `http://localhost:${port}`;
const onCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: onCi,
  retries: onCi ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
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
