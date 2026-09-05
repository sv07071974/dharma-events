import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const SUPERVISOR_EMAIL = 'dashboard-supervisor@example.test';
const SUPERVISOR_PASSWORD = 'supervisor-password-123';
const VOLUNTEER_EMAIL = 'dashboard-volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let supervisorCookie: string;
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
      email: SUPERVISOR_EMAIL,
      name: 'Dashboard Supervisor',
      role: Role.SUPERVISOR,
      passwordHash: await hashPassword(SUPERVISOR_PASSWORD),
    },
  });
  supervisorCookie = await loginAs(SUPERVISOR_EMAIL, SUPERVISOR_PASSWORD);

  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Dashboard Volunteer',
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
  const participant = await app.prisma.category.create({ data: { eventId: event.id, name: 'Participant' } });
  const guest = await app.prisma.category.create({ data: { eventId: event.id, name: 'Guest' } });

  const reg1 = await app.prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0001',
      name: 'Full Family',
      email: 'full@example.test',
      registeredCount: 4,
      categoryId: participant.id,
    },
  });
  const reg2 = await app.prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0002',
      name: 'Partial Family',
      email: 'partial@example.test',
      registeredCount: 3,
      categoryId: participant.id,
    },
  });
  const reg3 = await app.prisma.registration.create({
    data: {
      eventId: event.id,
      registrationNo: 'MDF26-0003',
      name: 'No Show Guest',
      email: 'noshow@example.test',
      registeredCount: 2,
      categoryId: guest.id,
    },
  });

  const supervisor = await app.prisma.user.findUniqueOrThrow({ where: { email: SUPERVISOR_EMAIL } });

  // reg1: fully checked in (4/4). reg2: partially checked in (1/3). reg3: no-show.
  await app.prisma.checkin.create({
    data: { eventId: event.id, registrationId: reg1.id, attendeeCount: 4, checkedById: supervisor.id, status: 'VALID' },
  });
  await app.prisma.checkin.create({
    data: { eventId: event.id, registrationId: reg2.id, attendeeCount: 1, checkedById: supervisor.id, status: 'VALID' },
  });

  return { event, participant, guest, reg1, reg2, reg3, supervisor };
}

describe('Dashboard APIs', () => {
  it('rejects a volunteer (SUPERVISOR+ required)', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/summary`,
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('summary matches database totals (Section 81 acceptance criteria)', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/summary`,
      headers: { cookie: supervisorCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      totalRegistrations: 3,
      totalCapacity: 9,
      totalArrived: 5,
      remaining: 4,
      attendancePercentage: 55.6,
      fullyCheckedIn: 1,
      partiallyCheckedIn: 1,
      notArrived: 1,
    });
  });

  it('breaks down by category', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/categories`,
      headers: { cookie: supervisorCookie },
    });

    expect(response.statusCode).toBe(200);
    const { categories } = response.json().data;
    const participant = categories.find((c: { name: string }) => c.name === 'Participant');
    const guest = categories.find((c: { name: string }) => c.name === 'Guest');
    expect(participant).toMatchObject({ registered: 7, arrived: 5 });
    expect(guest).toMatchObject({ registered: 2, arrived: 0 });
  });

  it('breaks down by the volunteer who performed the check-ins', async () => {
    const { event, supervisor } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/volunteers`,
      headers: { cookie: supervisorCookie },
    });

    expect(response.statusCode).toBe(200);
    const { volunteers } = response.json().data;
    expect(volunteers).toHaveLength(1);
    expect(volunteers[0]).toMatchObject({ userId: supervisor.id, checkedInCount: 5, checkinTransactions: 2 });
  });

  it('returns an hourly arrival timeline', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/timeline`,
      headers: { cookie: supervisorCookie },
    });

    expect(response.statusCode).toBe(200);
    const { timeline } = response.json().data;
    expect(timeline.length).toBeGreaterThan(0);
    const total = timeline.reduce((sum: number, t: { attendeeCount: number }) => sum + t.attendeeCount, 0);
    expect(total).toBe(5);
  });

  it('lists recent check-ins', async () => {
    const { event } = await seedEventWithData();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/dashboard/recent`,
      headers: { cookie: supervisorCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.checkins).toHaveLength(2);
  });
});
