import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { hashQrToken } from '@dharma-events/shared';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const VOLUNTEER_EMAIL = 'checkins-volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';
const SUPERVISOR_EMAIL = 'checkins-supervisor@example.test';
const SUPERVISOR_PASSWORD = 'supervisor-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let volunteerCookie: string;
let supervisorCookie: string;

async function loginAs(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === 'dharma_session');
  if (!cookie) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(response.json())}`);
  }
  return `dharma_session=${cookie.value}`;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = buildApp(buildTestEnv({ DATABASE_URL: testDb.databaseUrl }));
  await app.ready();

  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Checkins Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });
  volunteerCookie = await loginAs(VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD);

  await app.prisma.user.create({
    data: {
      email: SUPERVISOR_EMAIL,
      name: 'Checkins Supervisor',
      role: Role.SUPERVISOR,
      passwordHash: await hashPassword(SUPERVISOR_PASSWORD),
    },
  });
  supervisorCookie = await loginAs(SUPERVISOR_EMAIL, SUPERVISOR_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

beforeEach(async () => {
  await app.prisma.checkin.deleteMany();
  await app.prisma.registration.deleteMany();
  await app.prisma.category.deleteMany();
  await app.prisma.event.deleteMany();
});

async function seedActiveEvent(overrides: { checkinOpen?: boolean; status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' } = {}) {
  const event = await app.prisma.event.create({
    data: {
      eventCode: 'MDF26',
      eventName: 'myDharma Fest 2026',
      eventDate: new Date('2026-09-12'),
      venue: 'Main Hall',
      status: overrides.status ?? 'ACTIVE',
      checkinOpen: overrides.checkinOpen ?? true,
    },
  });
  const category = await app.prisma.category.create({ data: { eventId: event.id, name: 'Participant' } });
  return { event, category };
}

async function seedRegistration(
  eventId: string,
  categoryId: string,
  overrides: { registeredCount?: number; withQrToken?: boolean } = {},
) {
  const rawToken = 'a'.repeat(24) + Math.random().toString(36).slice(2);
  const registration = await app.prisma.registration.create({
    data: {
      eventId,
      registrationNo: `MDF26-${Math.floor(Math.random() * 1_000_000)}`,
      name: 'Jane Family',
      email: 'jane.family@example.test',
      registeredCount: overrides.registeredCount ?? 4,
      categoryId,
      qrTokenHash: overrides.withQrToken === false ? null : hashQrToken(rawToken),
    },
  });
  return { registration, rawToken };
}

describe('POST /api/v1/events/:eventId/qr/validate', () => {
  it('returns valid:true with computed counts for a good token', async () => {
    const { event, category } = await seedActiveEvent();
    const { rawToken } = await seedRegistration(event.id, category.id, { registeredCount: 4 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: rawToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.valid).toBe(true);
    expect(body.registration).toMatchObject({
      registeredCount: 4,
      checkedInCount: 0,
      remainingCount: 4,
      category: 'Participant',
    });
    expect(body.registration.email).toBeUndefined();
  });

  it('rejects a syntactically invalid token', async () => {
    const { event } = await seedActiveEvent();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: '!!!short' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ valid: false, reason: 'TOKEN_INVALID' });
  });

  it('rejects a well-formed but unknown token', async () => {
    const { event } = await seedActiveEvent();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: 'z'.repeat(32) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ valid: false, reason: 'TOKEN_NOT_FOUND' });
  });

  it('rejects a token belonging to a different event', async () => {
    const { event: eventA, category: categoryA } = await seedActiveEvent();
    const { rawToken } = await seedRegistration(eventA.id, categoryA.id);

    const eventB = await app.prisma.event.create({
      data: {
        eventCode: 'OTH26',
        eventName: 'Other Event',
        eventDate: new Date('2026-10-01'),
        status: 'ACTIVE',
        checkinOpen: true,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventB.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: rawToken },
    });
    expect(response.json().data).toMatchObject({ valid: false, reason: 'TOKEN_NOT_FOUND' });
  });

  it('rejects when check-in is not open', async () => {
    const { event, category } = await seedActiveEvent({ checkinOpen: false });
    const { rawToken } = await seedRegistration(event.id, category.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: rawToken },
    });
    expect(response.json().data).toMatchObject({ valid: false, reason: 'CHECKIN_CLOSED' });
  });

  it('rejects when the event is not active', async () => {
    const { event, category } = await seedActiveEvent({ status: 'DRAFT' });
    const { rawToken } = await seedRegistration(event.id, category.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/qr/validate`,
      headers: { cookie: volunteerCookie },
      payload: { token: rawToken },
    });
    expect(response.json().data).toMatchObject({ valid: false, reason: 'EVENT_NOT_ACTIVE' });
  });
});

describe('POST /api/v1/events/:eventId/checkins', () => {
  it('checks in a partial count and computes remaining correctly', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 4 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 2, counterName: 'Counter 2' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.registration).toMatchObject({ checkedInCount: 2, remainingCount: 2 });
    expect(body.checkin.attendeeCount).toBe(2);
    expect(body.checkin.status).toBe('VALID');
  });

  it('supports a second partial check-in completing the family (Section 26)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 4 });

    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 2 },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 2 },
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().data.registration).toMatchObject({ checkedInCount: 4, remainingCount: 0 });
  });

  it('rejects over-check-in beyond the remaining count (409)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 3 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('OVER_CHECKIN');
  });

  it('rejects a duplicate check-in once fully checked in (Section 27)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 2 },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 1 },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('OVER_CHECKIN');
  });

  it('rejects check-in when check-in is closed', async () => {
    const { event, category } = await seedActiveEvent({ checkinOpen: false });
    const { registration } = await seedRegistration(event.id, category.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CHECKIN_CLOSED');
  });

  it('processes concurrent check-in attempts without over-checking a shared registration', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 4 });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/events/${event.id}/checkins`,
          headers: { cookie: volunteerCookie },
          payload: { registrationId: registration.id, attendeeCount: 2 },
        }),
      ),
    );

    const succeeded = results.filter((r) => r.statusCode === 201);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(succeeded).toHaveLength(2);
    expect(rejected).toHaveLength(2);

    const checkins = await app.prisma.checkin.findMany({ where: { registrationId: registration.id } });
    const total = checkins.reduce((sum, c) => sum + c.attendeeCount, 0);
    expect(total).toBe(4);
  });
});

describe('GET /api/v1/registrations/:registrationId/checkin-status', () => {
  it('returns counts for manual-search check-in confirmation', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 3 });

    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 1 },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${registration.id}/checkin-status`,
      headers: { cookie: volunteerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.registration).toMatchObject({
      registeredCount: 3,
      checkedInCount: 1,
      remainingCount: 2,
    });
  });

  it('404s for an unknown registration', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/00000000-0000-0000-0000-000000000000/checkin-status',
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/events/:eventId/checkins/recent', () => {
  it('lists recent check-ins ordered newest first', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration: reg1 } = await seedRegistration(event.id, category.id, { registeredCount: 4 });
    const { registration: reg2 } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: reg1.id, attendeeCount: 1 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: reg2.id, attendeeCount: 2 },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/checkins/recent`,
      headers: { cookie: volunteerCookie },
    });

    expect(response.statusCode).toBe(200);
    const { checkins } = response.json().data;
    expect(checkins).toHaveLength(2);
    expect(checkins[0].registration.id).toBe(reg2.id);
    expect(checkins[0].checkedBy).toBe('Checkins Volunteer');
  });
});

describe('POST /api/v1/events/:eventId/checkins/override', () => {
  it('rejects a volunteer attempting an override (403)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins/override`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 3, reason: 'Late family member' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an override with no reason (400)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins/override`,
      headers: { cookie: supervisorCookie },
      payload: { registrationId: registration.id, attendeeCount: 3 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('allows a supervisor to override an over-check-in and records an audit entry', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins/override`,
      headers: { cookie: supervisorCookie },
      payload: { registrationId: registration.id, attendeeCount: 3, reason: 'Extra family member arrived' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.checkin.status).toBe('OVERRIDE');
    expect(body.checkin.notes).toBe('Extra family member arrived');
    expect(body.registration).toMatchObject({ checkedInCount: 3, remainingCount: -1 });

    const auditEntries = await app.prisma.auditLog.findMany({ where: { action: 'CHECKIN_OVERRIDE' } });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].metadata).toMatchObject({ reason: 'Extra family member arrived' });
  });
});

describe('POST /api/v1/checkins/:checkinId/reverse', () => {
  it('rejects a volunteer attempting a reversal (403)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });
    const checkin = await app.prisma.checkin.create({
      data: {
        eventId: event.id,
        registrationId: registration.id,
        attendeeCount: 2,
        checkedById: (await app.prisma.user.findUniqueOrThrow({ where: { email: VOLUNTEER_EMAIL } })).id,
        status: 'VALID',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/checkins/${checkin.id}/reverse`,
      headers: { cookie: volunteerCookie },
      payload: { reason: 'Wrong scan' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects a reversal with no reason (400)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });
    const checkin = await app.prisma.checkin.create({
      data: {
        eventId: event.id,
        registrationId: registration.id,
        attendeeCount: 2,
        checkedById: (await app.prisma.user.findUniqueOrThrow({ where: { email: VOLUNTEER_EMAIL } })).id,
        status: 'VALID',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/checkins/${checkin.id}/reverse`,
      headers: { cookie: supervisorCookie },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('allows a supervisor to reverse a check-in, updating calculated attendance and the audit log', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 4 });

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/checkins`,
      headers: { cookie: volunteerCookie },
      payload: { registrationId: registration.id, attendeeCount: 2 },
    });
    const checkinId = created.json().data.checkin.id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/checkins/${checkinId}/reverse`,
      headers: { cookie: supervisorCookie },
      payload: { reason: 'Scanned the wrong registration' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.checkin.status).toBe('REVERSED');
    expect(body.registration.checkedInCount).toBe(0);

    const auditEntries = await app.prisma.auditLog.findMany({ where: { action: 'CHECKIN_REVERSE' } });
    expect(auditEntries).toHaveLength(1);

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${registration.id}/checkin-status`,
      headers: { cookie: volunteerCookie },
    });
    expect(status.json().data.registration).toMatchObject({ checkedInCount: 0, remainingCount: 4 });
  });

  it('rejects reversing an already-reversed check-in (409)', async () => {
    const { event, category } = await seedActiveEvent();
    const { registration } = await seedRegistration(event.id, category.id, { registeredCount: 2 });
    const checkin = await app.prisma.checkin.create({
      data: {
        eventId: event.id,
        registrationId: registration.id,
        attendeeCount: 2,
        checkedById: (await app.prisma.user.findUniqueOrThrow({ where: { email: VOLUNTEER_EMAIL } })).id,
        status: 'VALID',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/checkins/${checkin.id}/reverse`,
      headers: { cookie: supervisorCookie },
      payload: { reason: 'First reversal' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/checkins/${checkin.id}/reverse`,
      headers: { cookie: supervisorCookie },
      payload: { reason: 'Second attempt' },
    });

    expect(second.statusCode).toBe(409);
  });

  it('404s for an unknown checkin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/checkins/00000000-0000-0000-0000-000000000000/reverse',
      headers: { cookie: supervisorCookie },
      payload: { reason: 'N/A' },
    });
    expect(response.statusCode).toBe(404);
  });
});
