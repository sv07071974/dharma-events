import { loadEnv, type Env } from '@dharma-events/shared';

/**
 * Builds a valid `Env` for worker tests without needing a real `.env` file.
 * Mirrors `apps/api/tests/helpers/build-test-env.ts`.
 */
export function buildTestEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
    SESSION_SECRET: 'test-only-session-secret-32-characters-long',
    PUBLIC_URL: 'https://events.example.test',
    EMAIL_MAX_RETRIES: '4',
    EMAIL_WORKER_BATCH_SIZE: '10',
    ...overrides,
  });
}
