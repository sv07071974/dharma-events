import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { createVolunteerSchema, updateVolunteerSchema } from '../events/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';

/**
 * Volunteer CRUD, scoped per event (REQUIREMENTS.md Section 42 - Volunteer
 * APIs; Section 12.4 - volunteers).
 */
export async function volunteerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/events/:eventId/volunteers',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const volunteers = await app.prisma.volunteer.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      });
      return apiSuccess({ volunteers });
    },
  );

  app.post(
    '/api/v1/events/:eventId/volunteers',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = createVolunteerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const volunteer = await app.prisma.volunteer.create({ data: { ...parsed.data, eventId } });

      await recordAuditLog(app.prisma, {
        eventId,
        userId: request.currentUser!.id,
        action: 'VOLUNTEER_CREATE',
        entityType: 'Volunteer',
        entityId: volunteer.id,
        ipAddress: request.ip,
      });

      return reply.status(201).send(apiSuccess({ volunteer }));
    },
  );

  app.patch(
    '/api/v1/volunteers/:volunteerId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { volunteerId } = request.params as { volunteerId: string };
      const existing = await app.prisma.volunteer.findUnique({ where: { id: volunteerId } });
      if (!existing) {
        return reply.status(404).send(apiError('VOLUNTEER_NOT_FOUND', 'Volunteer not found.'));
      }

      const parsed = updateVolunteerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const volunteer = await app.prisma.volunteer.update({
        where: { id: volunteerId },
        data: parsed.data,
      });

      await recordAuditLog(app.prisma, {
        eventId: volunteer.eventId,
        userId: request.currentUser!.id,
        action: 'VOLUNTEER_UPDATE',
        entityType: 'Volunteer',
        entityId: volunteer.id,
        metadata: parsed.data as Prisma.InputJsonValue,
        ipAddress: request.ip,
      });

      return apiSuccess({ volunteer });
    },
  );

  // Soft-delete (active = false) by default, so past check-ins/registrations
  // attributed to a volunteer are never orphaned (documented assumption -
  // mirrors the event/category soft-delete pattern). Passing `?hard=true`
  // permanently deletes the volunteer row instead - safe because
  // Registration.volunteerId uses `onDelete: SetNull` in the schema, so any
  // registrations that credited this volunteer simply lose that
  // attribution (the registration itself is never touched/deleted).
  app.delete(
    '/api/v1/volunteers/:volunteerId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { volunteerId } = request.params as { volunteerId: string };
      const { hard } = request.query as { hard?: string };
      const existing = await app.prisma.volunteer.findUnique({ where: { id: volunteerId } });
      if (!existing) {
        return reply.status(404).send(apiError('VOLUNTEER_NOT_FOUND', 'Volunteer not found.'));
      }

      if (hard === 'true') {
        await app.prisma.volunteer.delete({ where: { id: volunteerId } });

        await recordAuditLog(app.prisma, {
          eventId: existing.eventId,
          userId: request.currentUser!.id,
          action: 'VOLUNTEER_DELETE',
          entityType: 'Volunteer',
          entityId: volunteerId,
          ipAddress: request.ip,
        });

        return apiSuccess({ volunteer: { ...existing, deleted: true } });
      }

      const volunteer = await app.prisma.volunteer.update({
        where: { id: volunteerId },
        data: { active: false },
      });

      await recordAuditLog(app.prisma, {
        eventId: volunteer.eventId,
        userId: request.currentUser!.id,
        action: 'VOLUNTEER_DEACTIVATE',
        entityType: 'Volunteer',
        entityId: volunteer.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ volunteer });
    },
  );
}
