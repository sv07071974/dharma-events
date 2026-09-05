import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';

describe('GET /api/health', () => {
  it('returns an ok status envelope', async () => {
    const app = buildApp(buildTestEnv());
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');

    await app.close();
  });
});
