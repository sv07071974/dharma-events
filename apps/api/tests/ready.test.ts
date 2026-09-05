import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';

// Kept in its own file (rather than alongside health.test.ts) because the
// Prisma client is a process-wide singleton per test file (see
// packages/database/src/client.ts): the first buildApp() call in a file
// permanently fixes the connection the client uses. This file's sole
// buildApp() call must use the real embedded test database so /api/ready's
// DB-connectivity check has something real to verify.
describe('GET /api/ready', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    app = buildApp(buildTestEnv({ DATABASE_URL: testDb.databaseUrl }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns ready when the database is reachable and config is present', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/ready' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
  });

  // Note: a "database unreachable" 503 case isn't covered here because
  // swapping in a bad DATABASE_URL wouldn't create a new connection on the
  // already-initialized singleton. The failure branch is exercised manually
  // and via the compose.yml healthcheck in a real deployment.
});
