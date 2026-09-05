import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

const ADMIN_EMAIL = 'reg-admin@example.test';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const VOLUNTEER_EMAIL = 'reg-volunteer@example.test';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let adminCookie: string;
let volunteerCookie: string;
let eventId: string;
let participantCategoryId: string;

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

function buildCsv(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.join(',')).join('\n'));
}

function multipartUpload(csvBuffer: Buffer, mapping?: Record<string, string>): { payload: Buffer; contentType: string } {
  const boundary = '----dharmaEventsTestBoundary';
  const parts: (string | Buffer)[] = [];

  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\nContent-Type: text/csv\r\n\r\n`,
  );
  parts.push(csvBuffer);
  parts.push('\r\n');

  if (mapping) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n${JSON.stringify(mapping)}\r\n`,
    );
  }

  parts.push(`--${boundary}--\r\n`);

  return {
    payload: Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = buildApp(buildTestEnv({ DATABASE_URL: testDb.databaseUrl }));
  await app.ready();

  await app.prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: 'Registrations Admin',
      role: Role.ADMIN,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  await app.prisma.user.create({
    data: {
      email: VOLUNTEER_EMAIL,
      name: 'Registrations Volunteer',
      role: Role.VOLUNTEER,
      passwordHash: await hashPassword(VOLUNTEER_PASSWORD),
    },
  });

  adminCookie = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  volunteerCookie = await loginAs(VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD);

  const event = await app.prisma.event.create({
    data: { eventCode: 'REGTEST', eventName: 'Registration Test Event', eventDate: new Date('2026-08-01') },
  });
  eventId = event.id;

  const category = await app.prisma.category.create({
    data: { eventId, name: 'Participant' },
  });
  participantCategoryId = category.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

describe('Manual registration CRUD', () => {
  it('rejects a volunteer creating a registration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: volunteerCookie },
      payload: {
        name: 'Jane Doe',
        email: 'jane@example.test',
        registeredCount: 2,
        categoryId: participantCategoryId,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows an admin to create a registration with a generated registration number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
      payload: {
        name: 'Jane Doe',
        email: 'jane@example.test',
        registeredCount: 2,
        categoryId: participantCategoryId,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.registration.registrationNo).toBe('REGTEST-0001');
  });

  it('generates sequential registration numbers across successive creates', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
      payload: {
        name: 'John Doe',
        email: 'john@example.test',
        registeredCount: 1,
        categoryId: participantCategoryId,
      },
    });
    expect(response.json().data.registration.registrationNo).toBe('REGTEST-0002');
  });

  it('rejects a category that does not belong to the event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
      payload: {
        name: 'Bad Category',
        email: 'bad-category@example.test',
        registeredCount: 1,
        categoryId: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists and searches registrations', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.registrations.length).toBeGreaterThanOrEqual(2);

    const search = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/registrations/search?q=jane`,
      headers: { cookie: volunteerCookie },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().data.registrations.some((r: { email: string }) => r.email === 'jane@example.test')).toBe(
      true,
    );
  });

  it('rejects a volunteer listing the full registration list or fetching a single registration (SUPERVISOR+ only - check-in staff use /search instead)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: volunteerCookie },
    });
    expect(list.statusCode).toBe(403);

    const allRegistrations = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
    });
    const registrationId = allRegistrations.json().data.registrations[0].id;

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${registrationId}`,
      headers: { cookie: volunteerCookie },
    });
    expect(detail.statusCode).toBe(403);
  });

  it('updates a registration but registration number never changes', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/registrations`,
      headers: { cookie: adminCookie },
    });
    const registration = list.json().data.registrations[0];

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/registrations/${registration.id}`,
      headers: { cookie: adminCookie },
      payload: { phone: '555-0199' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.registration.registrationNo).toBe(registration.registrationNo);
    expect(update.json().data.registration.phone).toBe('555-0199');
  });
});

describe('Import preview and commit', () => {
  it('downloads an .xlsx template with headers that auto-detect correctly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/import/template`,
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain('.xlsx');
    expect(response.rawPayload.byteLength).toBeGreaterThan(0);
  });

  it('rejects a volunteer trying to download the import template', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/import/template`,
      headers: { cookie: volunteerCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('previews a CSV file without persisting anything', async () => {
    const csv = buildCsv([
      ['Timestamp', 'Email', 'Participant Name', 'WhatsApp', 'No. of Attendees', 'Category'],
      ['2026-01-01', 'preview1@example.test', 'Preview One', '5550001111', '1', 'Participant'],
      ['2026-01-02', 'not-an-email', 'Preview Two', '5550002222', '1', 'Participant'],
      ['2026-01-03', 'preview3@example.test', 'Preview Three', '5550003333', '0', 'Participant'],
      ['2026-01-04', 'preview4@example.test', 'Preview Four', '5550004444', '2', 'Unknown Category'],
    ]);
    const { payload, contentType } = multipartUpload(csv);

    const before = await app.prisma.registration.count({ where: { eventId } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/import/preview`,
      headers: { cookie: adminCookie, 'content-type': contentType },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.totalRows).toBe(4);
    expect(body.validCount).toBe(1);
    // Row 4's "Unknown Category" is a warning, not an error - it will be
    // auto-created on commit, so only rows 2 (bad email) and 3 (zero
    // attendees) are hard errors.
    expect(body.errorCount).toBe(2);
    expect(body.warningCount).toBe(1);

    const after = await app.prisma.registration.count({ where: { eventId } });
    expect(after).toBe(before);
  });

  it('rejects a volunteer attempting to preview an import', async () => {
    const csv = buildCsv([['Email'], ['x@example.test']]);
    const { payload, contentType } = multipartUpload(csv);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/import/preview`,
      headers: { cookie: volunteerCookie, 'content-type': contentType },
      payload,
    });
    expect(response.statusCode).toBe(403);
  });

  it('commits only valid/warning rows inside a single transaction, skipping error rows', async () => {
    const csv = buildCsv([
      ['Timestamp', 'Email', 'Participant Name', 'WhatsApp', 'No. of Attendees', 'Category'],
      ['2026-02-01', 'commit1@example.test', 'Commit One', '5559991111', '3', 'Participant'],
      ['2026-02-02', 'bad-email', 'Commit Two', '5559992222', '1', 'Participant'],
      ['2026-02-03', 'commit1@example.test', 'Commit One Duplicate', '5559993333', '1', 'Participant'],
    ]);
    const { payload, contentType } = multipartUpload(csv);

    const before = await app.prisma.registration.count({ where: { eventId } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/import/commit`,
      headers: { cookie: adminCookie, 'content-type': contentType },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.totalRows).toBe(3);
    expect(body.importedCount).toBe(2); // the two commit1@example.test rows (duplicate = warning, not error)
    expect(body.skippedErrorCount).toBe(1); // bad-email

    const after = await app.prisma.registration.count({ where: { eventId } });
    expect(after).toBe(before + 2);

    const imported = await app.prisma.registration.findMany({
      where: { eventId, email: 'commit1@example.test' },
    });
    expect(imported).toHaveLength(2);
    expect(imported.every((r) => r.duplicateFlag)).toBe(true);
  });

  it('auto-creates an unrecognized category and falls back to "Uncategorized" for a blank one', async () => {
    const csv = buildCsv([
      ['Timestamp', 'Email', 'Participant Name', 'WhatsApp', 'No. of Attendees', 'Category'],
      ['2026-03-01', 'newcat@example.test', 'New Cat Person', '5557771111', '1', 'Brand New Category'],
      ['2026-03-02', 'nocat@example.test', 'No Cat Person', '5557772222', '1', ''],
    ]);
    const { payload, contentType } = multipartUpload(csv);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/import/commit`,
      headers: { cookie: adminCookie, 'content-type': contentType },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.importedCount).toBe(2);
    expect(body.skippedErrorCount).toBe(0);

    const newCatRegistration = await app.prisma.registration.findFirstOrThrow({
      where: { eventId, email: 'newcat@example.test' },
      include: { category: true },
    });
    expect(newCatRegistration.category.name).toBe('Brand New Category');

    const noCatRegistration = await app.prisma.registration.findFirstOrThrow({
      where: { eventId, email: 'nocat@example.test' },
      include: { category: true },
    });
    expect(noCatRegistration.category.name).toBe('Uncategorized');
  });
});
