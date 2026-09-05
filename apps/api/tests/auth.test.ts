import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const VOLUNTEER_EMAIL = 'volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;

function extractSessionCookie(response: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = response.cookies.find((c) => c.name === 'dharma_session');
  if (!cookie) {
    throw new Error('Expected a dharma_session cookie in the response');
  }
  return `dharma_session=${cookie.value}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = buildApp(buildTestEnv({ DATABASE_URL: testDb.databaseUrl }));
  await app.ready();

  await app.prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: 'Test Admin',
      role: Role.ADMIN,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });

  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Test Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

describe('POST /api/v1/auth/login', () => {
  it('rejects an unknown email with a generic error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.test', password: 'whatever12345' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) },
    });
  });

  it('rejects a correct email with the wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: 'totally-wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a malformed request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email', password: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in a valid admin and never returns the password hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(ADMIN_EMAIL);
    expect(body.data.user.role).toBe('ADMIN');
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const cookie = response.cookies.find((c) => c.name === 'dharma_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('rejects anonymous requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user for a valid session cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.email).toBe(ADMIN_EMAIL);
  });

  it('rejects a garbage session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'dharma_session=not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('invalidates the session so it can no longer be used', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader },
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe('role-based authorization (GET/POST /api/v1/users)', () => {
  it('rejects a volunteer trying to list users', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: VOLUNTEER_EMAIL, password: VOLUNTEER_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to list users without exposing password hashes', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.users.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('allows an admin to create a new user', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: cookieHeader },
      payload: {
        email: 'new-supervisor@example.test',
        name: 'New Supervisor',
        password: 'a-strong-password-123',
        role: 'SUPERVISOR',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.user.role).toBe('SUPERVISOR');
    expect(body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects creating a user with a duplicate email', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: cookieHeader },
      payload: {
        email: ADMIN_EMAIL,
        name: 'Duplicate',
        password: 'another-strong-password',
        role: 'VOLUNTEER',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_IN_USE');
  });

  it('rejects a volunteer trying to create a user', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: VOLUNTEER_EMAIL, password: VOLUNTEER_PASSWORD },
    });
    const cookieHeader = extractSessionCookie(login);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: cookieHeader },
      payload: {
        email: 'should-not-be-created@example.test',
        name: 'Nope',
        password: 'a-strong-password-123',
        role: 'VOLUNTEER',
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
