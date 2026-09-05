import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import { apiError, apiSuccess, formatRegistrationNumber } from '@dharma-events/shared';
import { createRegistrationSchema, updateRegistrationSchema } from '../registrations/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';

/**
 * Registration CRUD and search (REQUIREMENTS.md Section 43 - Registration
 * APIs). Bulk creation happens via the Import APIs (routes/import.ts); this
 * module covers manual single-registration entry plus read/update/search.
 */
export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    // SUPERVISOR+ only - the full registrant list (names/emails/phones for
    // everyone) is a Registrations-management concern, not something
    // event-day check-in staff need; they use /search below instead.
    '/api/v1/events/:eventId/registrations',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      });
      return apiSuccess({ registrations });
    },
  );

  app.get(
    '/api/v1/events/:eventId/registrations/search',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const { q } = request.query as { q?: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      if (!q || !q.trim()) {
        return apiSuccess({ registrations: [] });
      }

      const term = q.trim();
      const registrations = await app.prisma.registration.findMany({
        where: {
          eventId,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term, mode: 'insensitive' } },
            { registrationNo: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });
      return apiSuccess({ registrations });
    },
  );

  app.post(
    '/api/v1/events/:eventId/registrations',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = createRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const category = await app.prisma.category.findFirst({
        where: { id: parsed.data.categoryId, eventId },
      });
      if (!category) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', 'Category does not belong to this event.'));
      }

      const registration = await app.prisma.$transaction(async (tx) => {
        const updatedEvent = await tx.event.update({
          where: { id: eventId },
          data: { registrationSeq: { increment: 1 } },
        });
        const registrationNo = formatRegistrationNumber(event.eventCode, updatedEvent.registrationSeq);

        return tx.registration.create({
          data: {
            eventId,
            registrationNo,
            name: parsed.data.name,
            email: parsed.data.email,
            phone: parsed.data.phone,
            registeredCount: parsed.data.registeredCount,
            categoryId: parsed.data.categoryId,
            volunteerId: parsed.data.volunteerId,
            sourceTimestamp: parsed.data.sourceTimestamp,
            notes: parsed.data.notes,
          },
        });
      });

      await recordAuditLog(app.prisma, {
        eventId,
        userId: request.currentUser!.id,
        action: 'REGISTRATION_CREATE',
        entityType: 'Registration',
        entityId: registration.id,
        ipAddress: request.ip,
      });

      return reply.status(201).send(apiSuccess({ registration }));
    },
  );

  app.get(
    // SUPERVISOR+ only - same reasoning as the list endpoint above; check-in
    // staff use the scanner's dedicated checkin-status endpoint instead.
    '/api/v1/registrations/:registrationId',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { registrationId } = request.params as { registrationId: string };
      const registration = await app.prisma.registration.findUnique({ where: { id: registrationId } });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found.'));
      }
      return apiSuccess({ registration });
    },
  );

  app.patch(
    '/api/v1/registrations/:registrationId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { registrationId } = request.params as { registrationId: string };
      const existing = await app.prisma.registration.findUnique({ where: { id: registrationId } });
      if (!existing) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found.'));
      }

      const parsed = updateRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      if (parsed.data.categoryId) {
        const category = await app.prisma.category.findFirst({
          where: { id: parsed.data.categoryId, eventId: existing.eventId },
        });
        if (!category) {
          return reply
            .status(400)
            .send(apiError('VALIDATION_ERROR', 'Category does not belong to this registration\'s event.'));
        }
      }

      const registration = await app.prisma.registration.update({
        where: { id: registrationId },
        data: parsed.data,
      });

      await recordAuditLog(app.prisma, {
        eventId: registration.eventId,
        userId: request.currentUser!.id,
        action: 'REGISTRATION_UPDATE',
        entityType: 'Registration',
        entityId: registration.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ registration });
    },
  );
}
