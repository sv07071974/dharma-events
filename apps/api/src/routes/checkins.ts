import type { FastifyInstance } from 'fastify';
import { Role, Prisma } from '@dharma-events/database';
import { apiError, apiSuccess, hashQrToken } from '@dharma-events/shared';
import { validateQrSchema, createCheckinSchema, overrideCheckinSchema, reverseCheckinSchema } from '../checkins/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';
import { COUNTING_STATUSES, sumCheckedIn, toScannerView } from '../checkins/helpers.js';

/** A raw QR token must look like the base64url output of `generateQrToken()`. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,}$/;


/**
 * QR validation and check-in APIs (REQUIREMENTS.md Sections 13-14, 46-47,
 * 50 - Phase 5). Override (Section 27/47 `/checkins/override`) and reversal
 * (`/checkins/:checkinId/reverse`) are Phase 6 (Supervisor Operations)
 * work, implemented further below in this same file.
 */
export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/events/:eventId/qr/validate',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = validateQrSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      // Rule 1: token is syntactically valid.
      if (!TOKEN_SHAPE.test(parsed.data.token)) {
        return apiSuccess({ valid: false, reason: 'TOKEN_INVALID', message: 'This QR code is not recognized.' });
      }

      const tokenHash = hashQrToken(parsed.data.token);
      const registration = await app.prisma.registration.findFirst({
        where: { qrTokenHash: tokenHash },
        include: { category: true },
      });

      // Rule 2: token exists. Rule 3: registration belongs to selected event.
      if (!registration || registration.eventId !== eventId) {
        return apiSuccess({ valid: false, reason: 'TOKEN_NOT_FOUND', message: 'This QR code is not recognized for this event.' });
      }

      // Rule 4: event is active.
      if (event.status !== 'ACTIVE') {
        return apiSuccess({ valid: false, reason: 'EVENT_NOT_ACTIVE', message: 'This event is not currently active.' });
      }

      // Rule 5: check-in is currently allowed.
      if (!event.checkinOpen) {
        return apiSuccess({ valid: false, reason: 'CHECKIN_CLOSED', message: 'Check-in is not currently open for this event.' });
      }

      // Rule 7: registered attendee count is greater than zero.
      if (registration.registeredCount <= 0) {
        return apiSuccess({ valid: false, reason: 'NO_ATTENDEES', message: 'This registration has no registered attendees.' });
      }

      // Rule 8: remaining attendee count is calculated.
      const checkedInCount = await sumCheckedIn(app.prisma, registration.id);
      return apiSuccess({
        valid: true,
        registration: toScannerView(registration, registration.category.name, checkedInCount),
      });
    },
  );

  /**
   * Manual-search check-in status (REQUIREMENTS.md Section 28 - "Manual
   * Participant Search" must lead to the same confirmation display as a QR
   * scan). Not in the spec's literal Section 46/47 API list; added so the
   * scanner UI's "Open" action can show registered/arrived counts without a
   * QR token, mirroring `POST /qr/validate`'s response shape.
   */
  app.get(
    '/api/v1/registrations/:registrationId/checkin-status',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { registrationId } = request.params as { registrationId: string };
      const registration = await app.prisma.registration.findUnique({
        where: { id: registrationId },
        include: { category: true },
      });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found.'));
      }
      const checkedInCount = await sumCheckedIn(app.prisma, registration.id);
      return apiSuccess({ registration: toScannerView(registration, registration.category.name, checkedInCount) });
    },
  );

  app.post(
    '/api/v1/events/:eventId/checkins',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = createCheckinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      if (event.status !== 'ACTIVE') {
        return reply.status(409).send(apiError('EVENT_NOT_ACTIVE', 'This event is not currently active.'));
      }
      if (!event.checkinOpen) {
        return reply.status(409).send(apiError('CHECKIN_CLOSED', 'Check-in is not currently open for this event.'));
      }

      const registration = await app.prisma.registration.findFirst({
        where: { id: parsed.data.registrationId, eventId },
      });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found for this event.'));
      }

      try {
        const result = await app.prisma.$transaction(async (tx) => {
          // Section 50: lock the registration row so concurrent check-in
          // attempts for the same registration are serialized - the
          // checked-in sum computed below is guaranteed consistent with
          // whichever transaction acquires the lock first.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`);

          const agg = await tx.checkin.aggregate({
            where: { registrationId: registration.id, status: { in: [...COUNTING_STATUSES] } },
            _sum: { attendeeCount: true },
          });
          const checkedInCount = agg._sum.attendeeCount ?? 0;
          const remainingCount = registration.registeredCount - checkedInCount;

          if (parsed.data.attendeeCount > remainingCount) {
            const err = new Error('OVER_CHECKIN') as Error & { checkedInCount: number; remainingCount: number };
            err.checkedInCount = checkedInCount;
            err.remainingCount = remainingCount;
            throw err;
          }

          const checkin = await tx.checkin.create({
            data: {
              eventId,
              registrationId: registration.id,
              attendeeCount: parsed.data.attendeeCount,
              checkedById: request.currentUser!.id,
              counterName: parsed.data.counterName,
              deviceId: parsed.data.deviceId,
              status: 'VALID',
            },
          });

          return { checkin, checkedInCount: checkedInCount + parsed.data.attendeeCount, remainingCount: remainingCount - parsed.data.attendeeCount };
        });

        await recordAuditLog(app.prisma, {
          eventId,
          userId: request.currentUser!.id,
          action: 'CHECKIN_CREATE',
          entityType: 'Registration',
          entityId: registration.id,
          metadata: { attendeeCount: parsed.data.attendeeCount, checkinId: result.checkin.id },
          ipAddress: request.ip,
        });

        return reply.status(201).send(
          apiSuccess({
            checkin: result.checkin,
            registration: {
              id: registration.id,
              checkedInCount: result.checkedInCount,
              remainingCount: result.remainingCount,
            },
          }),
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'OVER_CHECKIN') {
          const { checkedInCount, remainingCount } = err as Error & {
            checkedInCount: number;
            remainingCount: number;
          };
          return reply.status(409).send(
            apiError(
              'OVER_CHECKIN',
              `Requested ${parsed.data.attendeeCount} but only ${remainingCount} of ${registration.registeredCount} remain (already checked in: ${checkedInCount}).`,
            ),
          );
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/events/:eventId/checkins/recent',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const { limit } = request.query as { limit?: string };
      const take = Math.min(Math.max(Number.parseInt(limit ?? '20', 10) || 20, 1), 100);

      const checkins = await app.prisma.checkin.findMany({
        where: { eventId, status: { in: [...COUNTING_STATUSES] } },
        include: { registration: true, checkedBy: { select: { id: true, name: true } } },
        orderBy: { checkedInAt: 'desc' },
        take,
      });

      return apiSuccess({
        checkins: checkins.map((c) => ({
          id: c.id,
          checkedInAt: c.checkedInAt,
          attendeeCount: c.attendeeCount,
          counterName: c.counterName,
          status: c.status,
          checkedBy: c.checkedBy.name,
          registration: {
            id: c.registration.id,
            registrationNo: c.registration.registrationNo,
            name: c.registration.name,
          },
        })),
      });
    },
  );

  /**
   * Supervisor override of an over-check-in (REQUIREMENTS.md Section 27/47,
   * Phase 6 Section 80). Bypasses the remaining-attendee-count guard that
   * `POST /checkins` enforces, but only for SUPERVISOR+; always records a
   * mandatory reason and an audit log entry.
   */
  app.post(
    '/api/v1/events/:eventId/checkins/override',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = overrideCheckinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      if (event.status !== 'ACTIVE') {
        return reply.status(409).send(apiError('EVENT_NOT_ACTIVE', 'This event is not currently active.'));
      }

      const registration = await app.prisma.registration.findFirst({
        where: { id: parsed.data.registrationId, eventId },
      });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found for this event.'));
      }

      const result = await app.prisma.$transaction(async (tx) => {
        // Same row-lock discipline as the normal check-in path (Section
        // 50), even though the remaining-count check is intentionally
        // bypassed here - the checked-in sum returned to the caller must
        // still be consistent with any concurrent check-ins.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM registrations WHERE id = ${registration.id} FOR UPDATE`);

        const agg = await tx.checkin.aggregate({
          where: { registrationId: registration.id, status: { in: [...COUNTING_STATUSES] } },
          _sum: { attendeeCount: true },
        });
        const checkedInCount = agg._sum.attendeeCount ?? 0;

        const checkin = await tx.checkin.create({
          data: {
            eventId,
            registrationId: registration.id,
            attendeeCount: parsed.data.attendeeCount,
            checkedById: request.currentUser!.id,
            counterName: parsed.data.counterName,
            deviceId: parsed.data.deviceId,
            status: 'OVERRIDE',
            notes: parsed.data.reason,
          },
        });

        return {
          checkin,
          checkedInCount: checkedInCount + parsed.data.attendeeCount,
          remainingCount: registration.registeredCount - checkedInCount - parsed.data.attendeeCount,
        };
      });

      await recordAuditLog(app.prisma, {
        eventId,
        userId: request.currentUser!.id,
        action: 'CHECKIN_OVERRIDE',
        entityType: 'Registration',
        entityId: registration.id,
        metadata: { attendeeCount: parsed.data.attendeeCount, checkinId: result.checkin.id, reason: parsed.data.reason },
        ipAddress: request.ip,
      });

      return reply.status(201).send(
        apiSuccess({
          checkin: result.checkin,
          registration: {
            id: registration.id,
            checkedInCount: result.checkedInCount,
            remainingCount: result.remainingCount,
          },
        }),
      );
    },
  );

  /**
   * Check-in reversal (REQUIREMENTS.md Section 80). Marks a check-in
   * REVERSED rather than deleting it (Section 12.6: "checkins" is an
   * append-only transaction log; "Total arrivals must be calculated from
   * valid check-in transactions"). Reversed rows are excluded from
   * `COUNTING_STATUSES`, so this immediately updates the calculated
   * attendance for the registration.
   */
  app.post(
    '/api/v1/checkins/:checkinId/reverse',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { checkinId } = request.params as { checkinId: string };

      const parsed = reverseCheckinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const checkin = await app.prisma.checkin.findUnique({ where: { id: checkinId } });
      if (!checkin) {
        return reply.status(404).send(apiError('CHECKIN_NOT_FOUND', 'Check-in not found.'));
      }
      if (checkin.status === 'REVERSED') {
        return reply.status(409).send(apiError('ALREADY_REVERSED', 'This check-in has already been reversed.'));
      }

      const reversed = await app.prisma.checkin.update({
        where: { id: checkinId },
        data: { status: 'REVERSED', notes: parsed.data.reason },
      });

      const checkedInCount = await sumCheckedIn(app.prisma, checkin.registrationId);

      await recordAuditLog(app.prisma, {
        eventId: checkin.eventId,
        userId: request.currentUser!.id,
        action: 'CHECKIN_REVERSE',
        entityType: 'Registration',
        entityId: checkin.registrationId,
        metadata: { checkinId: reversed.id, reason: parsed.data.reason, previousStatus: checkin.status },
        ipAddress: request.ip,
      });

      return apiSuccess({
        checkin: reversed,
        registration: { id: checkin.registrationId, checkedInCount },
      });
    },
  );
}
