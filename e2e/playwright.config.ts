import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against the running local stack (`make up && make demo`):
 * the web app (which proxies /api), the API and worker, Postgres, Redis, S3 and SES on the
 * Floci emulator, Mailpit for the mail SES relays, and the model stub (apps/stubs).
 *
 *   pnpm e2e                               every spec in e2e/tests
 *   pnpm e2e e2e/tests/01-auth.spec.ts     one spec
 *   E2E_HEADED=1 pnpm e2e                  watch it
 *
 * The harness (helpers.ts, global-setup.ts, resume-helpers.ts) and the specs live here.
 * Every spec creates its own people
 * through the API, so spec files run in parallel and never see each other's data; tests
 * inside a file run in order.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  outputDir: ".results",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3630",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !process.env.E2E_HEADED,
    // Optional: a system Chrome/Chromium when Playwright's own browser is not installed.
    launchOptions: process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : {},
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
