import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestDatabase } from '@dharma-events/database/test-db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const FIXTURES_PATH = path.join(__dirname, '.e2e-fixtures.json');

export const ADMIN_EMAIL = 'e2e-admin@dharma-events.test';
export const ADMIN_PASSWORD = 'E2E-test-password-123!';
const SESSION_SECRET = 'e2e-test-session-secret-not-for-production-use-only';
const API_PORT = 3000;
const API_BASE_URL = `http://localhost:${API_PORT}`;

export interface E2eFixtures {
  eventId: string;
  categoryId: string;
  adminEmail: string;
  adminPassword: string;
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy at ${url} within ${timeoutMs}ms: ${String(lastError)}`);
}

/**
 * Playwright global setup (Section 13 - Regression Test Requirements).
 *
 * Boots a real, disposable stack for E2E: an ephemeral embedded-Postgres
 * database (same helper used by the API/worker integration tests), the real
 * API server (not a mock), an idempotent admin bootstrap, and a seeded
 * "E2E Test Event" + category fixture that every spec file can read via
 * `FIXTURES_PATH`. The `web` dev server itself is started separately by
 * Playwright's own `webServer` config (see playwright.config.ts) and proxies
 * `/api/*` to this API instance on port 3000, matching the existing
 * `apps/web/vite.config.ts` dev proxy target - so no frontend config changes
 * were needed to support E2E.
 *
 * Per Section 14 (Test Data Rules): this never touches a real/production
 * database, uses a clearly-prefixed test event name, and only ever sends
 * email via the worker's tested FakeMailer-equivalent path - the worker
 * itself is never started here, so no real SMTP send can occur during E2E.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const testDb = await startTestDatabase();

  const commonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: testDb.databaseUrl,
    SESSION_SECRET,
    NODE_ENV: 'test',
    // Rate limiting defaults are tuned for production brute-force
    // protection; E2E runs many sequential logins (valid + invalid cases)
    // so the limit is raised well above what a single spec run needs.
    LOGIN_RATE_LIMIT_MAX: '1000',
  };

  execFileSync('pnpm', ['--filter', '@dharma-events/api', 'exec', 'tsx', 'src/cli/bootstrap-admin.ts'], {
    cwd: repoRoot,
    env: { ...commonEnv, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME: 'E2E Admin' },
    stdio: 'inherit',
  });

  const apiProcess: ChildProcess = spawn(
    'pnpm',
    ['--filter', '@dharma-events/api', 'exec', 'tsx', 'src/server.ts'],
    { cwd: repoRoot, env: commonEnv, stdio: 'inherit' },
  );

  await waitForHealth(`${API_BASE_URL}/api/health`);

  const loginRes = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`E2E admin bootstrap login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) {
    throw new Error('E2E admin bootstrap login did not return a session cookie.');
  }
  const authHeaders = { 'content-type': 'application/json', cookie };

  const eventRes = await fetch(`${API_BASE_URL}/api/v1/events`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      eventCode: 'E2E-TEST',
      eventName: 'E2E Test Event',
      eventDate: '2030-01-15',
    }),
  });
  if (!eventRes.ok) {
    throw new Error(`E2E fixture event creation failed: ${eventRes.status} ${await eventRes.text()}`);
  }
  const { data: eventData } = (await eventRes.json()) as { data: { event: { id: string } } };
  const eventId = eventData.event.id;

  // Open registration/check-in and mark the event Active so every screen
  // (registrations, invitations, scanner) is testable without an extra
  // manual step per spec file.
  const patchRes = await fetch(`${API_BASE_URL}/api/v1/events/${eventId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ACTIVE', registrationOpen: true, checkinOpen: true }),
  });
  if (!patchRes.ok) {
    throw new Error(`E2E fixture event activation failed: ${patchRes.status} ${await patchRes.text()}`);
  }

  const categoryRes = await fetch(`${API_BASE_URL}/api/v1/events/${eventId}/categories`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'General', sortOrder: 1 }),
  });
  if (!categoryRes.ok) {
    throw new Error(`E2E fixture category creation failed: ${categoryRes.status} ${await categoryRes.text()}`);
  }
  const { data: categoryData } = (await categoryRes.json()) as { data: { category: { id: string } } };

  const fixtures: E2eFixtures = {
    eventId,
    categoryId: categoryData.category.id,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  };
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));

  return async () => {
    apiProcess.kill();
    await testDb.stop();
    fs.rmSync(FIXTURES_PATH, { force: true });
  };
}
