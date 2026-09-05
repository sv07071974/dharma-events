import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma, Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { createEventSchema, updateEventSchema } from '../events/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';
import { roleSatisfies } from '../auth/rbac.js';

// Excludes `inviteAttachmentData` (can be several MB of raw PDF bytes) from
// every JSON event response - only `inviteAttachmentFilename`/`Size` are
// returned so the web UI can show "attached: <name>" without ever shipping
// the bytes themselves over the regular event APIs (see the dedicated
// `/invite-attachment` download route below for that).
const eventSelect = {
  id: true,
  eventCode: true,
  eventName: true,
  description: true,
  eventDate: true,
  venue: true,
  status: true,
  registrationOpen: true,
  checkinOpen: true,
  registrationSeq: true,
  inviteAttachmentFilename: true,
  inviteAttachmentSize: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

const MAX_INVITE_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB - generous for a flyer/brochure PDF.

/**
 * Event CRUD (REQUIREMENTS.md Section 40 - Event APIs, Section 76 - Phase 2
 * acceptance criteria: admin creates events; event managers can manage
 * events; volunteers can view but never change event configuration).
 *
 * NOTE (documented assumption): REQUIREMENTS.md does not define an explicit
 * "which events is this EVENT_MANAGER assigned to" table (Section 12 has no
 * event-manager-assignment model). Until such a model is introduced,
 * EVENT_MANAGER+ may manage every event, not just an "assigned" subset.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/events', { preHandler: app.requireRole(Role.VOLUNTEER) }, async () => {
    const events = await app.prisma.event.findMany({ orderBy: { eventDate: 'desc' }, select: eventSelect });
    return apiSuccess({ events });
  });

  app.post('/api/v1/events', { preHandler: app.requireRole(Role.EVENT_MANAGER) }, async (request, reply) => {
    const parsed = createEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
    }

    try {
      const event = await app.prisma.event.create({ data: parsed.data, select: eventSelect });

      await recordAuditLog(app.prisma, {
        eventId: event.id,
        userId: request.currentUser!.id,
        action: 'EVENT_CREATE',
        entityType: 'Event',
        entityId: event.id,
        ipAddress: request.ip,
      });

      return reply.status(201).send(apiSuccess({ event }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply
          .status(409)
          .send(apiError('EVENT_CODE_IN_USE', 'An event with this event code already exists.'));
      }
      throw err;
    }
  });

  app.get(
    '/api/v1/events/:eventId',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId }, select: eventSelect });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }
      return apiSuccess({ event });
    },
  );

  app.patch(
    '/api/v1/events/:eventId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const parsed = updateEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const existing = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      try {
        const event = await app.prisma.event.update({
          where: { id: eventId },
          data: parsed.data,
          select: eventSelect,
        });

        await recordAuditLog(app.prisma, {
          eventId: event.id,
          userId: request.currentUser!.id,
          action: 'EVENT_UPDATE',
          entityType: 'Event',
          entityId: event.id,
          metadata: parsed.data as Prisma.InputJsonValue,
          ipAddress: request.ip,
        });

        return apiSuccess({ event });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply
            .status(409)
            .send(apiError('EVENT_CODE_IN_USE', 'An event with this event code already exists.'));
        }
        throw err;
      }
    },
  );

  // REQUIREMENTS.md Section 40: "Deletion should preferably soft-delete or
  // archive events." Default behavior is archiving (status = ARCHIVED), so
  // historical registrations/check-ins are never orphaned. Passing
  // `?hard=true` instead permanently deletes the event row and every
  // dependent record (categories/volunteers/registrations/check-ins/
  // invitation jobs all use `onDelete: Cascade` on their eventId relation in
  // schema.prisma - AuditLog.eventId uses `onDelete: SetNull` instead, so
  // the audit trail survives with a null event reference). This is
  // restricted to ADMIN (stricter than the EVENT_MANAGER+ needed for a
  // plain archive) since it is irreversible and intended for clearing out
  // test/duplicate events, not routine event lifecycle management.
  app.delete(
    '/api/v1/events/:eventId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const { hard } = request.query as { hard?: string };
      const existing = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      if (hard === 'true') {
        if (!roleSatisfies(request.currentUser!.role, Role.ADMIN)) {
          return reply
            .status(403)
            .send(apiError('FORBIDDEN', 'Only an administrator can permanently delete an event.'));
        }

        await app.prisma.event.delete({ where: { id: eventId } });

        await recordAuditLog(app.prisma, {
          eventId: null,
          userId: request.currentUser!.id,
          action: 'EVENT_DELETE',
          entityType: 'Event',
          entityId: eventId,
          metadata: { eventCode: existing.eventCode, eventName: existing.eventName },
          ipAddress: request.ip,
        });

        return apiSuccess({ event: { ...existing, deleted: true } });
      }

      const event = await app.prisma.event.update({
        where: { id: eventId },
        data: { status: 'ARCHIVED', registrationOpen: false, checkinOpen: false },
        select: eventSelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: event.id,
        userId: request.currentUser!.id,
        action: 'EVENT_ARCHIVE',
        entityType: 'Event',
        entityId: event.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ event });
    },
  );

  /**
   * Uploads (or replaces) the event's optional invite attachment PDF - a
   * flyer/brochure/formal invite letter that gets appended after each
   * participant's generated ticket page when invitations are emailed (see
   * `mergePdfDocuments` in packages/shared and its use in
   * routes/invitations.ts and apps/worker/src/invitation-worker.ts).
   */
  app.post(
    '/api/v1/events/:eventId/invite-attachment',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const existing = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const body = request.body as { file?: MultipartFile } | undefined;
      const file = body?.file;
      if (!file) {
        return reply.status(400).send(apiError('VALIDATION_ERROR', 'A PDF file upload is required.'));
      }
      if (file.mimetype !== 'application/pdf') {
        return reply.status(400).send(apiError('VALIDATION_ERROR', 'The invite attachment must be a PDF file.'));
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_INVITE_ATTACHMENT_BYTES) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', 'The invite attachment must be 15MB or smaller.'));
      }

      const event = await app.prisma.event.update({
        where: { id: eventId },
        data: {
          inviteAttachmentData: buffer,
          inviteAttachmentFilename: file.filename,
          inviteAttachmentSize: buffer.byteLength,
        },
        select: eventSelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: event.id,
        userId: request.currentUser!.id,
        action: 'EVENT_INVITE_ATTACHMENT_UPLOAD',
        entityType: 'Event',
        entityId: event.id,
        metadata: { filename: file.filename, size: buffer.byteLength },
        ipAddress: request.ip,
      });

      return apiSuccess({ event });
    },
  );

  /** Streams the raw invite attachment PDF back (used for the "View" link in the web UI). */
  app.get(
    '/api/v1/events/:eventId/invite-attachment',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({
        where: { id: eventId },
        select: { inviteAttachmentData: true, inviteAttachmentFilename: true },
      });
      if (!event?.inviteAttachmentData) {
        return reply.status(404).send(apiError('INVITE_ATTACHMENT_NOT_FOUND', 'No invite attachment uploaded.'));
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${event.inviteAttachmentFilename ?? 'invite-attachment.pdf'}"`)
        .send(event.inviteAttachmentData);
    },
  );

  app.delete(
    '/api/v1/events/:eventId/invite-attachment',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const existing = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const event = await app.prisma.event.update({
        where: { id: eventId },
        data: { inviteAttachmentData: null, inviteAttachmentFilename: null, inviteAttachmentSize: null },
        select: eventSelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: event.id,
        userId: request.currentUser!.id,
        action: 'EVENT_INVITE_ATTACHMENT_REMOVE',
        entityType: 'Event',
        entityId: event.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ event });
    },
  );
}
