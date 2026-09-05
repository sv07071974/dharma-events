import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const MANAGER_EMAIL = 'invitations-manager@example.test';
const MANAGER_PASSWORD = 'event-manager-password-123';
const VOLUNTEER_EMAIL = 'invitations-volunteer@example.test';
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
      email: MANAGER_EMAIL,
      name: 'Invitations Manager',
      role: Role.EVENT_MANAGER,
      passwordHash: await hashPassword(MANAGER_PASSWORD),
    },
  });
  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Invitations Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });

  managerCookie = await loginAs(MANAGER_EMAIL, MANAGER_PASSWORD);
  volunteerCookie = await loginAs(VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

beforeEach(async () => {
  await app.prisma.invitationJob.deleteMany();
  await app.prisma.registration.deleteMany();
  await app.prisma.volunteer.deleteMany();
  await app.prisma.category.deleteMany();
  await app.prisma.event.deleteMany();
});

async function seedEventWithRegistrations(count = 2) {
  const event = await app.prisma.event.create({
    data: {
      eventCode: 'MDF26',
      eventName: 'myDharma Fest 2026',
      eventDate: new Date('2026-09-12'),
      venue: 'Main Hall',
    },
  });
  const category = await app.prisma.category.create({ data: { eventId: event.id, name: 'Participant' } });
  const registrations = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      app.prisma.registration.create({
        data: {
          eventId: event.id,
          registrationNo: `MDF26-000${i + 1}`,
          name: `Participant ${i + 1}`,
          email: `participant${i + 1}@example.test`,
          registeredCount: 1,
          categoryId: category.id,
        },
      }),
    ),
  );
  return { event, category, registrations };
}

describe('GET /api/v1/events/:eventId/invitations', () => {
  it('returns a summary and the registration list', async () => {
    const { event } = await seedEventWithRegistrations(3);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.summary).toEqual({ total: 3, ready: 3, pending: 0, sent: 0, failed: 0 });
    expect(body.data.registrations).toHaveLength(3);
  });

  it('rejects a volunteer (EVENT_MANAGER+ only)', async () => {
    const { event } = await seedEventWithRegistrations(1);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/invitations`,
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('404s for an unknown event', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events/00000000-0000-0000-0000-000000000000/invitations',
      headers: { cookie: managerCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/events/:eventId/invitations/generate', () => {
  it('queues a PENDING invitation job for every ready registration', async () => {
    const { event, registrations } = await seedEventWithRegistrations(2);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/invitations/generate`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.queuedCount).toBe(2);

    const jobs = await app.prisma.invitationJob.findMany({ where: { eventId: event.id } });
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === 'PENDING')).toBe(true);

    const updated = await app.prisma.registration.findMany({ where: { id: { in: registrations.map((r) => r.id) } } });
    expect(updated.every((r) => r.invitationStatus === 'PENDING')).toBe(true);
  });

  it('is idempotent: does not double-queue registrations already queued', async () => {
    const { event } = await seedEventWithRegistrations(2);

    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/invitations/generate`,
      headers: { cookie: managerCookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/invitations/generate`,
      headers: { cookie: managerCookie },
    });

    expect(second.json().data.queuedCount).toBe(0);
    const jobs = await app.prisma.invitationJob.findMany({ where: { eventId: event.id } });
    expect(jobs).toHaveLength(2);
  });
});

describe('POST /api/v1/events/:eventId/invitations/send', () => {
  it('sends all ready registrations when no body is given', async () => {
    const { event } = await seedEventWithRegistrations(2);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/invitations/send`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.queuedCount).toBe(2);
  });

  it('sends only the selected registrationIds', async () => {
    const { event, registrations } = await seedEventWithRegistrations(3);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/invitations/send`,
      headers: { cookie: managerCookie },
      payload: { registrationIds: [registrations[0]!.id] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.queuedCount).toBe(1);

    const jobs = await app.prisma.invitationJob.findMany({ where: { eventId: event.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.registrationId).toBe(registrations[0]!.id);
  });
});

describe('POST /api/v1/registrations/:registrationId/invitation/resend', () => {
  it('creates a new job and resets invitationStatus to PENDING even if already SENT', async () => {
    const { registrations } = await seedEventWithRegistrations(1);
    await app.prisma.registration.update({
      where: { id: registrations[0]!.id },
      data: { invitationStatus: 'SENT', invitationSentAt: new Date() },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/registrations/${registrations[0]!.id}/invitation/resend`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(201);
    const registration = await app.prisma.registration.findUniqueOrThrow({ where: { id: registrations[0]!.id } });
    expect(registration.invitationStatus).toBe('PENDING');

    const jobs = await app.prisma.invitationJob.findMany({ where: { registrationId: registrations[0]!.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('PENDING');
  });

  it('rejects a resend while a job is already in progress', async () => {
    const { registrations } = await seedEventWithRegistrations(1);
    await app.prisma.invitationJob.create({
      data: {
        eventId: (await app.prisma.registration.findUniqueOrThrow({ where: { id: registrations[0]!.id } })).eventId,
        registrationId: registrations[0]!.id,
        status: 'PENDING',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/registrations/${registrations[0]!.id}/invitation/resend`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('GET /api/v1/invitation-jobs/:jobId', () => {
  it('returns job details including the registration', async () => {
    const { event, registrations } = await seedEventWithRegistrations(1);
    const job = await app.prisma.invitationJob.create({
      data: { eventId: event.id, registrationId: registrations[0]!.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/invitation-jobs/${job.id}`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.job.registration.id).toBe(registrations[0]!.id);
  });

  it('404s for an unknown job', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/invitation-jobs/00000000-0000-0000-0000-000000000000',
      headers: { cookie: managerCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/registrations/:registrationId/invitation/preview', () => {
  it('renders a PDF without persisting anything', async () => {
    const { registrations } = await seedEventWithRegistrations(1);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${registrations[0]!.id}/invitation/preview`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    const registration = await app.prisma.registration.findUniqueOrThrow({ where: { id: registrations[0]!.id } });
    expect(registration.qrTokenHash).toBeNull();
    expect(registration.invitationStatus).toBe('NOT_SENT');

    const jobs = await app.prisma.invitationJob.findMany({ where: { registrationId: registrations[0]!.id } });
    expect(jobs).toHaveLength(0);
  });
});
