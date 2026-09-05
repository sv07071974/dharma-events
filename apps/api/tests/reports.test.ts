import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const EVENT_MANAGER_EMAIL = 'reports-manager@example.test';
const EVENT_MANAGER_PASSWORD = 'manager-password-123';
const VOLUNTEER_EMAIL = 'reports-volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let managerCookie: string;
let volunteerCookie: string;

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
      email: EVENT_MANAGER_EMAIL,
      name: 'Reports Manager',
      role: Role.EVENT_MANAGER,
      passwordHash: await hashPassword(EVENT_MANAGER_PASSWORD),
    },
  });
  managerCookie = await loginAs(EVENT_MANAGER_EMAIL, EVENT_MANAGER_PASSWORD);

  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Reports Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });
  volunteerCookie = await loginAs(VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

beforeEach(async () => {
  await app.prisma.invitationJob.deleteMany();
  await app.prisma.checkin.deleteMany();
  await app.prisma.registration.deleteMany();
  await app.prisma.category.deleteMany();
  await app.prisma.event.deleteMany();
});

async function seedEventWithData() {
  const event = await app.prisma.event.create({
    data: {
      eventCode: 'MDF26',
      eventName: 'myDharma Fest 2026',
      eventDate: new Date('2026-09-12'),
      status: 'ACTIVE',
      checkinOpen: true,
    },
  });
  const category = await app.prisma.category.create({ data: { eventId: event.id, name: 'Participant' } });

  const reg1 = await app.prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0001',
      name: 'Full Family',
      email: 'full@example.test',
      registeredCount: 4,
      categoryId: category.id,
      invitationStatus: 'SENT',
      invitationSentAt: new Date('2026-09-01T10:00:00Z'),
    },
  });
  const reg2 = await app.prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0002',
      name: 'No Show Guest',
      email: 'noshow@example.test',
      registeredCount: 2,
      categoryId: category.id,
      invitationStatus: 'FAILED',
    },
  });

  const manager = await app.prisma.user.findUniqueOrThrow({ where: { email: EVENT_MANAGER_EMAIL } });

  await app.prisma.checkin.create({
    data: { eventId: event.id, registrationId: reg1.id, attendeeCount: 4, checkedById: manager.id, status: 'VALID' },
  });
  await app.prisma.invitationJob.create({
    data: { eventId: event.id, registrationId: reg2.id, status: 'FAILED', attemptCount: 4, errorMessage: 'SMTP timeout' },
  });

  return { event, reg1, reg2 };
}

describe('Report APIs', () => {
  it('rejects a volunteer (EVENT_MANAGER+ required)', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/attendance`,
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('attendance report reconciles with check-in records', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/attendance`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const { rows } = response.json().data;
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { registrationNo: string }) => r.registrationNo === 'MDF26-0001')).toMatchObject({
      checkedInCount: 4,
      remainingCount: 0,
      status: 'FULLY_CHECKED_IN',
    });
    expect(rows.find((r: { registrationNo: string }) => r.registrationNo === 'MDF26-0002')).toMatchObject({
      checkedInCount: 0,
      remainingCount: 2,
      status: 'NOT_ARRIVED',
    });
  });

  it('attendance report supports CSV export', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/attendance?format=csv`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain('MDF26-0001');
  });

  it('attendance report supports XLSX export', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/attendance?format=xlsx`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it('no-show report only lists registrations with zero check-ins', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/no-show`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const { rows } = response.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0].registrationNo).toBe('MDF26-0002');
  });

  it('check-in transaction report lists every checkin', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/checkins`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const { rows } = response.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ registrationNo: 'MDF26-0001', attendeeCount: 4, status: 'VALID' });
  });

  it('invitation delivery report includes failed jobs', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reports/invitations`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const { rows } = response.json().data;
    const failed = rows.find((r: { registrationNo: string }) => r.registrationNo === 'MDF26-0002');
    expect(failed).toMatchObject({ invitationStatus: 'FAILED', attemptCount: 4, errorMessage: 'SMTP timeout' });
  });
});
