import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { startTestDatabase, type TestDatabase } from '@dharma-events/database/test-db';
import { generateQrToken, hashQrToken } from '@dharma-events/shared';
import { buildApp } from '../src/app.js';
import { buildTestEnv } from './helpers/build-test-env.js';
import { hashPassword } from '../src/auth/password.js';

/**
 * Phase 9 - Event Simulation (REQUIREMENTS.md Section 83).
 *
 * Seeds a realistic full-scale event (1,000 registrations / 10 volunteers /
 * 10 check-in counters / multiple categories / partial family attendance)
 * against a single real (embedded) database, then simulates the load
 * patterns Section 83 calls out - concurrent scans, repeated QR scans, a
 * bulk invitation queue, and dashboard polling - asserting its five
 * acceptance criteria hold at scale, not just for the small fixtures used
 * elsewhere in the API test suite.
 *
 * Note on scale: this file uses `it(..., { timeout })` overrides on the
 * heavier tests since ~1,000-2,000 total HTTP-shaped `app.inject()` calls
 * against a real (if embedded) Postgres instance comfortably exceeds
 * Vitest's 5s default per-test timeout, even though it's well within what a
 * production deployment would handle in normal operation.
 */

const CATEGORY_NAMES = ['Participant', 'Volunteer', 'Satsang', 'Guest'];
const REGISTERED_COUNTS = [1, 2, 4]; // single / family of 2 / family of 4 - Section 83 "partial family attendance"
const VOLUNTEER_COUNT = 10;
const COUNTER_COUNT = 10;
const REGISTRATION_COUNT = 1000;

const EVENT_MANAGER_EMAIL = 'sim-event-manager@example.test';
const EVENT_MANAGER_PASSWORD = 'event-manager-password-123';
const SUPERVISOR_EMAIL = 'sim-supervisor@example.test';
const SUPERVISOR_PASSWORD = 'supervisor-password-123';
const VOLUNTEER_PASSWORD = 'volunteer-password-123';

let testDb: TestDatabase;
let app: FastifyInstance;
let eventId: string;
let volunteerCookies: string[];
let supervisorCookie: string;
let eventManagerCookie: string;
let registrationIds: string[];
let registrationRegisteredCount: Map<string, number>;
let qrTokensByRegistrationId: Map<string, string>;

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

  const event = await app.prisma.event.create({
    data: {
      eventCode: 'MDF26SIM',
      eventName: 'myDharma Fest 2026 (Simulation)',
      eventDate: new Date('2026-09-12'),
      venue: 'Main Hall',
      status: 'ACTIVE',
      checkinOpen: true,
    },
  });
  eventId = event.id;

  const categories = await Promise.all(
    CATEGORY_NAMES.map((name, i) =>
      app.prisma.category.create({ data: { eventId, name, sortOrder: i } }),
    ),
  );

  await app.prisma.user.create({
    data: {
      email: EVENT_MANAGER_EMAIL,
      name: 'Simulation Event Manager',
      role: Role.EVENT_MANAGER,
      passwordHash: await hashPassword(EVENT_MANAGER_PASSWORD),
    },
  });
  eventManagerCookie = await loginAs(EVENT_MANAGER_EMAIL, EVENT_MANAGER_PASSWORD);

  await app.prisma.user.create({
    data: {
      email: SUPERVISOR_EMAIL,
      name: 'Simulation Supervisor',
      role: Role.SUPERVISOR,
      passwordHash: await hashPassword(SUPERVISOR_PASSWORD),
    },
  });
  supervisorCookie = await loginAs(SUPERVISOR_EMAIL, SUPERVISOR_PASSWORD);

  // Section 83: "10 volunteers".
  const volunteerPasswordHash = await hashPassword(VOLUNTEER_PASSWORD);
  const volunteerEmails = Array.from({ length: VOLUNTEER_COUNT }, (_, i) => `sim-volunteer-${i}@example.test`);
  await app.prisma.user.createMany({
    data: volunteerEmails.map((email, i) => ({
      email,
      name: `Simulation Volunteer ${i}`,
      role: Role.VOLUNTEER,
      passwordHash: volunteerPasswordHash,
    })),
  });
  volunteerCookies = await Promise.all(volunteerEmails.map((email) => loginAs(email, VOLUNTEER_PASSWORD)));

  // Section 83: "1,000 registrations ... multiple categories ... partial
  // family attendance". Registration numbers are generated locally (rather
  // than via the real /registrations create endpoint, which serializes
  // through a single `registrationSeq` counter) purely for seeding
  // throughput - the numbers themselves still follow the same
  // "MDF26SIM-0001" shape and uniqueness guarantee as production.
  qrTokensByRegistrationId = new Map();
  registrationRegisteredCount = new Map();
  const rawTokens: string[] = Array.from({ length: REGISTRATION_COUNT }, () => generateQrToken());
  const created = await app.prisma.registration.createManyAndReturn({
    data: Array.from({ length: REGISTRATION_COUNT }, (_, i) => {
      const registeredCount = REGISTERED_COUNTS[i % REGISTERED_COUNTS.length];
      return {
        eventId,
        registrationNo: `MDF26SIM-${String(i + 1).padStart(4, '0')}`,
        name: `Simulated Attendee ${i + 1}`,
        email: `sim-attendee-${i + 1}@example.test`,
        registeredCount,
        categoryId: categories[i % categories.length].id,
        qrTokenHash: hashQrToken(rawTokens[i]),
        invitationStatus: 'NOT_SENT',
      };
    }),
  });
  created.forEach((r, i) => {
    qrTokensByRegistrationId.set(r.id, rawTokens[i]);
    registrationRegisteredCount.set(r.id, r.registeredCount);
  });
  registrationIds = created.map((r) => r.id);
}, 60_000);

afterAll(async () => {
  await app.close();
  await testDb.stop();
});

function volunteerFor(i: number): { cookie: string; counterName: string } {
  return {
    cookie: volunteerCookies[i % VOLUNTEER_COUNT],
    counterName: `Counter-${(i % COUNTER_COUNT) + 1}`,
  };
}

describe('Phase 9 - Event Simulation', () => {
  it('seeds the full-scale event fixture', () => {
    expect(registrationIds).toHaveLength(REGISTRATION_COUNT);
    // "No duplicate registration IDs" (Section 83 acceptance criteria) -
    // checked here at seed time, and again at the end against the live
    // table in case any later phase (e.g. import-like inserts) introduced
    // a collision.
    expect(new Set(registrationIds).size).toBe(REGISTRATION_COUNT);
  });

  it(
    'simulates concurrent scans across many different registrations (full check-in via the real QR-validate -> check-in flow)',
    async () => {
      const batch = registrationIds.slice(0, 300);

      const results = await Promise.all(
        batch.map(async (registrationId, i) => {
          const { cookie, counterName } = volunteerFor(i);
          const token = qrTokensByRegistrationId.get(registrationId)!;

          const validateResponse = await app.inject({
            method: 'POST',
            url: `/api/v1/events/${eventId}/qr/validate`,
            headers: { cookie },
            payload: { token },
          });
          expect(validateResponse.statusCode).toBe(200);
          expect(validateResponse.json().data.valid).toBe(true);

          return app.inject({
            method: 'POST',
            url: `/api/v1/events/${eventId}/checkins`,
            headers: { cookie },
            payload: {
              registrationId,
              attendeeCount: registrationRegisteredCount.get(registrationId)!,
              counterName,
            },
          });
        }),
      );

      // No 500s (no unhandled errors/deadlocks) and every distinct
      // registration's single full-attendee check-in succeeds.
      const failures = results.filter((r) => r.statusCode !== 201);
      expect(failures).toHaveLength(0);
    },
    30_000,
  );

  it(
    'simulates repeated QR scans of the same registration without over-check-in',
    async () => {
      // A fresh batch, disjoint from the one above, so this test's
      // "already checked in" assertions aren't affected by prior state.
      const batch = registrationIds.slice(300, 400);

      const results = await Promise.all(
        batch.flatMap((registrationId, i) => {
          const { cookie, counterName } = volunteerFor(i);
          const attendeeCount = registrationRegisteredCount.get(registrationId)!;
          // Three volunteers "scan the same badge" for this registration at
          // effectively the same instant.
          return [0, 1, 2].map(() =>
            app.inject({
              method: 'POST',
              url: `/api/v1/events/${eventId}/checkins`,
              headers: { cookie },
              payload: { registrationId, attendeeCount, counterName },
            }),
          );
        }),
      );

      const succeeded = results.filter((r) => r.statusCode === 201);
      const rejected = results.filter((r) => r.statusCode === 409);
      const unexpected = results.filter((r) => r.statusCode !== 201 && r.statusCode !== 409);

      // Exactly one of the three concurrent "scans" wins per registration;
      // the other two are cleanly rejected as OVER_CHECKIN (never a crash).
      expect(succeeded).toHaveLength(batch.length);
      expect(rejected).toHaveLength(batch.length * 2);
      expect(unexpected).toHaveLength(0);
      for (const r of rejected) {
        expect(r.json().error.code).toBe('OVER_CHECKIN');
      }

      // Reconcile against the database: no registration in this batch was
      // over-checked-in.
      const checkins = await app.prisma.checkin.groupBy({
        by: ['registrationId'],
        where: { registrationId: { in: batch } },
        _sum: { attendeeCount: true },
      });
      for (const row of checkins) {
        const registeredCount = registrationRegisteredCount.get(row.registrationId)!;
        expect(row._sum.attendeeCount).toBe(registeredCount);
      }
    },
    30_000,
  );

  it(
    'simulates a bulk invitation email queue for all 1,000 registrations',
    async () => {
      const generateResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/invitations/generate`,
        headers: { cookie: eventManagerCookie },
      });
      expect(generateResponse.statusCode).toBe(200);
      expect(generateResponse.json().data.queuedCount).toBe(REGISTRATION_COUNT);

      const jobCount = await app.prisma.invitationJob.count({ where: { eventId } });
      expect(jobCount).toBe(REGISTRATION_COUNT);

      // No duplicate jobs: exactly one job per registration.
      const jobsPerRegistration = await app.prisma.invitationJob.groupBy({
        by: ['registrationId'],
        where: { eventId },
        _count: true,
      });
      expect(jobsPerRegistration.every((row) => row._count === 1)).toBe(true);

      const pendingCount = await app.prisma.registration.count({
        where: { eventId, invitationStatus: 'PENDING' },
      });
      expect(pendingCount).toBe(REGISTRATION_COUNT);
    },
    30_000,
  );

  it(
    'keeps the dashboard responsive and reconciled with the database while check-ins are happening concurrently',
    async () => {
      const batch = registrationIds.slice(400, 600); // a fresh, not-yet-checked-in batch

      const checkinRequests = batch.map((registrationId, i) => {
        const { cookie, counterName } = volunteerFor(i);
        return app.inject({
          method: 'POST',
          url: `/api/v1/events/${eventId}/checkins`,
          headers: { cookie },
          payload: {
            registrationId,
            attendeeCount: registrationRegisteredCount.get(registrationId)!,
            counterName,
          },
        });
      });

      // Section 83: "Dashboard polling" - fire a burst of summary requests
      // concurrently with the check-in load above, mirroring the real
      // frontend's 5-second polling interval (Section 31) under load.
      const dashboardRequests = Array.from({ length: 15 }, () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/events/${eventId}/dashboard/summary`,
          headers: { cookie: supervisorCookie },
        }),
      );

      const start = Date.now();
      const [checkinResults, dashboardResults] = await Promise.all([
        Promise.all(checkinRequests),
        Promise.all(dashboardRequests),
      ]);
      const elapsedMs = Date.now() - start;

      expect(checkinResults.filter((r) => r.statusCode !== 201)).toHaveLength(0);
      expect(dashboardResults.filter((r) => r.statusCode !== 200)).toHaveLength(0);
      // Generous ceiling for an embedded-Postgres CI sandbox - the point is
      // "didn't hang/time out", not a production latency SLA.
      expect(elapsedMs).toBeLessThan(20_000);

      // Reconcile: the dashboard's final summary (checked-in count) must
      // match the actual sum of counting check-in statuses in the DB,
      // even immediately after a burst of concurrent writes.
      const finalSummary = await app.inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/dashboard/summary`,
        headers: { cookie: supervisorCookie },
      });
      expect(finalSummary.statusCode).toBe(200);

      const agg = await app.prisma.checkin.aggregate({
        where: { eventId, status: { in: ['VALID', 'OVERRIDE'] } },
        _sum: { attendeeCount: true },
      });
      expect(finalSummary.json().data.totalArrived).toBe(agg._sum.attendeeCount ?? 0);
    },
    30_000,
  );

  it('holds all Section 83 acceptance criteria across the whole simulated event', async () => {
    // No duplicate registration IDs (re-checked against the live table).
    const distinctRegistrationNos = await app.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM (
        SELECT registration_no FROM registrations WHERE event_id = ${eventId}
        GROUP BY registration_no HAVING COUNT(*) > 1
      ) dup
    `;
    expect(Number(distinctRegistrationNos[0].count)).toBe(0);

    // No over-check-in for any registration in the whole event.
    const perRegistration = await app.prisma.checkin.groupBy({
      by: ['registrationId'],
      where: { eventId, status: { in: ['VALID', 'OVERRIDE'] } },
      _sum: { attendeeCount: true },
    });
    for (const row of perRegistration) {
      const registeredCount = registrationRegisteredCount.get(row.registrationId)!;
      expect(row._sum.attendeeCount).toBeLessThanOrEqual(registeredCount);
    }

    // "No database deadlocks during normal load" / "errors are logged
    // clearly": every request across every phase above resolved with an
    // explicit, well-formed status code (201/200/409) and never a bare
    // 500 - already asserted per-phase; Section 61's structured logging
    // (Phase 8) is what makes any future error clearly attributable
    // (requestId/route/httpStatus/userId/duration/errorType), so it isn't
    // re-verified here as a log-output assertion.
  });
});
