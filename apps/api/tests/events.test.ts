import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const ADMIN_EMAIL = 'events-admin@example.test';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const MANAGER_EMAIL = 'events-manager@example.test';
const MANAGER_PASSWORD = 'event-manager-password-123';
const VOLUNTEER_EMAIL = 'events-volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let adminCookie: string;
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
      email: ADMIN_EMAIL,
      name: 'Events Admin',
      role: Role.ADMIN,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  await app.prisma.user.create({
    data: {
      email: MANAGER_EMAIL,
      name: 'Events Manager',
      role: Role.EVENT_MANAGER,
      passwordHash: await hashPassword(MANAGER_PASSWORD),
    },
  });
  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Events Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });

  adminCookie = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  managerCookie = await loginAs(MANAGER_EMAIL, MANAGER_PASSWORD);
  volunteerCookie = await loginAs(VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD);
}, 60_000);

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

describe('Event CRUD (POST/GET/PATCH/DELETE /api/v1/events)', () => {
  it('rejects a volunteer trying to create an event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: volunteerCookie },
      payload: { eventCode: 'VOL-CREATE', eventName: 'Should not be created', eventDate: '2026-01-01' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows an admin to create an event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: {
        eventCode: 'SATSANG-2026',
        eventName: 'Annual Satsang 2026',
        eventDate: '2026-03-15',
        venue: 'Main Hall',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.event.eventCode).toBe('SATSANG-2026');
    expect(body.data.event.status).toBe('DRAFT');
  });

  it('allows an event manager to create and update an event', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: managerCookie },
      payload: {
        eventCode: 'MANAGER-EVENT',
        eventName: 'Manager Created Event',
        eventDate: '2026-04-01',
      },
    });
    expect(create.statusCode).toBe(201);
    const eventId = create.json().data.event.id;

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: managerCookie },
      payload: { status: 'ACTIVE', registrationOpen: true },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.event.status).toBe('ACTIVE');
    expect(update.json().data.event.registrationOpen).toBe(true);
  });

  it('rejects a duplicate event code with 409', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { eventCode: 'SATSANG-2026', eventName: 'Duplicate', eventDate: '2026-03-15' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EVENT_CODE_IN_USE');
  });

  it('allows a volunteer to list and view events but never mutate them', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/events',
      headers: { cookie: volunteerCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.events.length).toBeGreaterThanOrEqual(2);

    const eventId = list.json().data.events[0].id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: volunteerCookie },
      payload: { registrationOpen: true },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: volunteerCookie },
    });
    expect(del.statusCode).toBe(403);
  });

  it('returns 404 for an unknown event id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events/00000000-0000-0000-0000-000000000000',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it('archives (soft-deletes) an event instead of hard-deleting it', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { eventCode: 'TO-ARCHIVE', eventName: 'Archive Me', eventDate: '2026-05-01' },
    });
    const eventId = create.json().data.event.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.event.status).toBe('ARCHIVED');

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}`,
      headers: { cookie: adminCookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.event.status).toBe('ARCHIVED');
  });
});

describe('Category CRUD (per event)', () => {
  let eventId: string;

  beforeAll(async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { eventCode: 'CATEGORY-EVENT', eventName: 'Category Test Event', eventDate: '2026-06-01' },
    });
    eventId = create.json().data.event.id;
  });

  it('rejects a volunteer creating a category', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: volunteerCookie },
      payload: { name: 'Participant' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows an event manager to create categories scoped to the event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'Participant', sortOrder: 1 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.category.name).toBe('Participant');
    expect(response.json().data.category.eventId).toBe(eventId);
  });

  it('lists categories for the event', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'Volunteer', sortOrder: 2 },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.categories.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a duplicate category name within the same event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'Participant' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('updates and soft-deletes a category', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'VIP' },
    });
    const categoryId = create.json().data.category.id;

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${categoryId}`,
      headers: { cookie: managerCookie },
      payload: { description: 'VIP guests' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.category.description).toBe('VIP guests');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${categoryId}`,
      headers: { cookie: managerCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.category.active).toBe(false);
  });

  it('allows an event manager to upload, view, and remove a category-specific invite attachment', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'Category With Template' },
    });
    const categoryId = create.json().data.category.id;

    const pdfBytes = Buffer.from('%PDF-1.4 fake category invite content');
    const { payload, contentType } = buildMultipartPdfUpload(pdfBytes, 'category-invite.pdf');

    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/invite-attachment`,
      headers: { cookie: managerCookie, 'content-type': contentType },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const uploadedCategory = upload.json().data.category;
    expect(uploadedCategory.inviteAttachmentFilename).toBe('category-invite.pdf');
    expect(uploadedCategory.inviteAttachmentSize).toBe(pdfBytes.byteLength);
    expect(uploadedCategory.inviteAttachmentData).toBeUndefined();

    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/categories/${categoryId}/invite-attachment`,
      headers: { cookie: volunteerCookie },
    });
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(view.rawPayload).toEqual(pdfBytes);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${categoryId}/invite-attachment`,
      headers: { cookie: managerCookie },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().data.category.inviteAttachmentFilename).toBeNull();

    const viewAfterRemove = await app.inject({
      method: 'GET',
      url: `/api/v1/categories/${categoryId}/invite-attachment`,
      headers: { cookie: volunteerCookie },
    });
    expect(viewAfterRemove.statusCode).toBe(404);
  });

  it('rejects a volunteer trying to upload a category invite attachment', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/categories`,
      headers: { cookie: managerCookie },
      payload: { name: 'Category Locked For Volunteer' },
    });
    const categoryId = create.json().data.category.id;
    const { payload, contentType } = buildMultipartPdfUpload(Buffer.from('%PDF-1.4 fake'));

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/invite-attachment`,
      headers: { cookie: volunteerCookie, 'content-type': contentType },
      payload,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('Volunteer CRUD (per event)', () => {
  let eventId: string;

  beforeAll(async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { eventCode: 'VOLUNTEER-EVENT', eventName: 'Volunteer Test Event', eventDate: '2026-07-01' },
    });
    eventId = create.json().data.event.id;
  });

  it('rejects a volunteer creating another volunteer record', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/volunteers`,
      headers: { cookie: volunteerCookie },
      payload: { name: 'New Volunteer', email: 'nv@example.test', role: 'Registration Desk' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows an event manager to create, list, update and deactivate volunteers', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/volunteers`,
      headers: { cookie: managerCookie },
      payload: { name: 'Jane Doe', email: 'jane@example.test', role: 'Scanner Operator' },
    });
    expect(create.statusCode).toBe(201);
    const volunteerId = create.json().data.volunteer.id;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/volunteers`,
      headers: { cookie: volunteerCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.volunteers.length).toBeGreaterThanOrEqual(1);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/volunteers/${volunteerId}`,
      headers: { cookie: managerCookie },
      payload: { phone: '555-0100' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.volunteer.phone).toBe('555-0100');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/volunteers/${volunteerId}`,
      headers: { cookie: managerCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.volunteer.active).toBe(false);
  });

  it('returns 404 when creating a volunteer for an unknown event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events/00000000-0000-0000-0000-000000000000/volunteers',
      headers: { cookie: managerCookie },
      payload: { name: 'Nobody', email: 'nobody@example.test', role: 'Ghost' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('permanently deletes a volunteer with ?hard=true instead of just deactivating', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/volunteers`,
      headers: { cookie: managerCookie },
      payload: { name: 'Hard Delete Me', email: 'hard-delete@example.test', role: 'Registration Desk' },
    });
    const volunteerId = create.json().data.volunteer.id;

    const hardDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/volunteers/${volunteerId}?hard=true`,
      headers: { cookie: managerCookie },
    });
    expect(hardDelete.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/volunteers`,
      headers: { cookie: volunteerCookie },
    });
    expect(list.json().data.volunteers.some((v: { id: string }) => v.id === volunteerId)).toBe(false);
  });
});

function buildMultipartPdfUpload(pdfBuffer: Buffer, filename = 'invite.pdf'): { payload: Buffer; contentType: string } {
  const boundary = '----dharmaEventsInviteAttachmentBoundary';
  const parts: (string | Buffer)[] = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    pdfBuffer,
    '\r\n',
    `--${boundary}--\r\n`,
  ];
  return {
    payload: Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('Event invite attachment (POST/GET/DELETE /api/v1/events/:eventId/invite-attachment)', () => {
  let eventId: string;

  beforeAll(async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie: adminCookie },
      payload: { eventCode: 'INVITE-ATTACH-EVENT', eventName: 'Invite Attachment Test Event', eventDate: '2026-08-01' },
    });
    eventId = create.json().data.event.id;
  });

  it('rejects a volunteer trying to upload an invite attachment', async () => {
    const { payload, contentType } = buildMultipartPdfUpload(Buffer.from('%PDF-1.4 fake'));
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: volunteerCookie, 'content-type': contentType },
      payload,
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a non-PDF file upload', async () => {
    const boundary = '----dharmaEventsInviteAttachmentBoundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: managerCookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('allows an event manager to upload, view, and remove the invite attachment', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake invite content');
    const { payload, contentType } = buildMultipartPdfUpload(pdfBytes, 'invite.pdf');

    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: managerCookie, 'content-type': contentType },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const uploadedEvent = upload.json().data.event;
    expect(uploadedEvent.inviteAttachmentFilename).toBe('invite.pdf');
    expect(uploadedEvent.inviteAttachmentSize).toBe(pdfBytes.byteLength);
    expect(uploadedEvent.inviteAttachmentData).toBeUndefined();

    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: volunteerCookie },
    });
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(view.rawPayload).toEqual(pdfBytes);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: managerCookie },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().data.event.inviteAttachmentFilename).toBeNull();

    const viewAfterRemove = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/invite-attachment`,
      headers: { cookie: volunteerCookie },
    });
    expect(viewAfterRemove.statusCode).toBe(404);
  });

  it('returns 404 for an unknown event', async () => {
    const { payload, contentType } = buildMultipartPdfUpload(Buffer.from('%PDF-1.4 fake'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events/00000000-0000-0000-0000-000000000000/invite-attachment',
      headers: { cookie: managerCookie, 'content-type': contentType },
      payload,
    });
    expect(response.statusCode).toBe(404);
  });
});
