import { loadEnv, type Env } from '@dharma-events/shared';

/**
 * Builds a valid `Env` for tests without needing a real `.env` file.
 * Override individual fields (notably `DATABASE_URL`) as needed per test.
 */
export function buildTestEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
    SESSION_SECRET: 'test-only-session-secret-32-characters-long',
    SESSION_TTL_HOURS: '12',
    LOGIN_RATE_LIMIT_MAX: '1000',
    ...overrides,
  });
}
