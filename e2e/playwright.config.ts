import { defineConfig } from '@playwright/test';

/**
 * Playwright end-to-end configuration.
 *
 * `globalSetup` (see global-setup.ts) boots a real, disposable stack: an
 * ephemeral embedded-Postgres database, the real API server on port 3000
 * (matching this dev-server proxy target below), an idempotent admin
 * bootstrap, and a seeded "E2E Test Event" fixture. `webServer` here only
 * starts the frontend dev server - the API is managed separately so its
 * database can be provisioned first.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  globalSetup: './global-setup.ts',
  webServer: {
    command: 'pnpm --filter @dharma-events/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
});
