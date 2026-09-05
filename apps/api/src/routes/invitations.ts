import type { FastifyInstance } from 'fastify';
import { Role } from '@dharma-events/database';
import {
  apiError,
  apiSuccess,
  buildQrUrl,
  generateQrToken,
  renderQrPng,
  renderInvitationPdf,
  invitationPdfFilename,
  mergePdfDocuments,
} from '@dharma-events/shared';
import { sendInvitationsSchema } from '../invitations/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';

function formatEventDate(eventDate: Date): string {
  return eventDate.toISOString().slice(0, 10);
}

/**
 * Invitation management APIs (REQUIREMENTS.md Section 45 / Section 78 -
 * Phase 4). Sending is never done inline in these handlers - every route
 * only creates/inspects `invitation_jobs` rows; the worker (Section 21)
 * generates the QR/PDF and delivers the email asynchronously.
 */
export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/events/:eventId/invitations',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
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

      const summary = {
        total: registrations.length,
        ready: registrations.filter((r) => r.invitationStatus === 'NOT_SENT').length,
        pending: registrations.filter((r) => r.invitationStatus === 'PENDING').length,
        sent: registrations.filter((r) => r.invitationStatus === 'SENT').length,
        failed: registrations.filter((r) => r.invitationStatus === 'FAILED').length,
      };

      return apiSuccess({ summary, registrations });
    },
  );

  app.get(
    '/api/v1/invitation-jobs/:jobId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = await app.prisma.invitationJob.findUnique({
        where: { id: jobId },
        include: { registration: true },
      });
      if (!job) {
        return reply.status(404).send(apiError('INVITATION_JOB_NOT_FOUND', 'Invitation job not found.'));
      }
      return apiSuccess({ job });
    },
  );

  /**
   * Queues invitation jobs for every "ready" (NOT_SENT, no in-flight job)
   * registration in the event. `/invitations/generate` and
   * `/invitations/send` (without a body) are equivalent - see
   * docs/ASSUMPTIONS.md for why Section 18's separate "Generate
   * Invitations"/"Send All Ready" buttons were not split into two
   * differently-behaving actions.
   */
  async function queueReadyInvitations(
    eventId: string,
    actorUserId: string,
    ipAddress: string | undefined,
  ): Promise<{ queuedCount: number }> {
    const ready = await app.prisma.registration.findMany({
      where: { eventId, invitationStatus: 'NOT_SENT' },
      select: { id: true },
    });

    if (ready.length === 0) {
      return { queuedCount: 0 };
    }

    await app.prisma.$transaction([
      app.prisma.invitationJob.createMany({
        data: ready.map((r) => ({ eventId, registrationId: r.id })),
      }),
      app.prisma.registration.updateMany({
        where: { id: { in: ready.map((r) => r.id) } },
        data: { invitationStatus: 'PENDING' },
      }),
    ]);

    await recordAuditLog(app.prisma, {
      eventId,
      userId: actorUserId,
      action: 'INVITATION_SEND',
      entityType: 'Registration',
      metadata: { queuedCount: ready.length },
      ipAddress: ipAddress ?? null,
    });

    return { queuedCount: ready.length };
  }

  app.post(
    '/api/v1/events/:eventId/invitations/generate',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const result = await queueReadyInvitations(eventId, request.currentUser!.id, request.ip);
      return apiSuccess(result);
    },
  );

  app.post(
    '/api/v1/events/:eventId/invitations/send',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = sendInvitationsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      if (!parsed.data.registrationIds) {
        // "Send All Ready".
        const result = await queueReadyInvitations(eventId, request.currentUser!.id, request.ip);
        return apiSuccess(result);
      }

      // "Send Selected": only registrations belonging to this event and
      // currently NOT_SENT are queued; others are silently skipped.
      const selected = await app.prisma.registration.findMany({
        where: { eventId, id: { in: parsed.data.registrationIds }, invitationStatus: 'NOT_SENT' },
        select: { id: true },
      });

      if (selected.length === 0) {
        return apiSuccess({ queuedCount: 0 });
      }

      await app.prisma.$transaction([
        app.prisma.invitationJob.createMany({
          data: selected.map((r) => ({ eventId, registrationId: r.id })),
        }),
        app.prisma.registration.updateMany({
          where: { id: { in: selected.map((r) => r.id) } },
          data: { invitationStatus: 'PENDING' },
        }),
      ]);

      await recordAuditLog(app.prisma, {
        eventId,
        userId: request.currentUser!.id,
        action: 'INVITATION_SEND',
        entityType: 'Registration',
        metadata: { queuedCount: selected.length, selected: true },
        ipAddress: request.ip,
      });

      return apiSuccess({ queuedCount: selected.length });
    },
  );

  app.post(
    '/api/v1/registrations/:registrationId/invitation/resend',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { registrationId } = request.params as { registrationId: string };
      const registration = await app.prisma.registration.findUnique({ where: { id: registrationId } });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found.'));
      }

      const activeJob = await app.prisma.invitationJob.findFirst({
        where: { registrationId, status: { in: ['PENDING', 'PROCESSING'] } },
      });
      if (activeJob) {
        return reply
          .status(409)
          .send(apiError('INVITATION_JOB_IN_PROGRESS', 'An invitation job is already in progress for this registration.'));
      }

      const job = await app.prisma.$transaction(async (tx) => {
        const created = await tx.invitationJob.create({
          data: { eventId: registration.eventId, registrationId },
        });
        await tx.registration.update({ where: { id: registrationId }, data: { invitationStatus: 'PENDING' } });
        return created;
      });

      await recordAuditLog(app.prisma, {
        eventId: registration.eventId,
        userId: request.currentUser!.id,
        action: 'INVITATION_RESEND',
        entityType: 'Registration',
        entityId: registrationId,
        ipAddress: request.ip,
      });

      return reply.status(201).send(apiSuccess({ job }));
    },
  );

  /**
   * Renders an ephemeral preview PDF for admin review (Section 78 -
   * "Invitation preview"). Uses a throwaway QR token that is never
   * persisted or hashed anywhere - previewing must have no side effects.
   */
  app.get(
    '/api/v1/registrations/:registrationId/invitation/preview',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { registrationId } = request.params as { registrationId: string };
      const registration = await app.prisma.registration.findUnique({
        where: { id: registrationId },
        include: { event: true, category: true },
      });
      if (!registration) {
        return reply.status(404).send(apiError('REGISTRATION_NOT_FOUND', 'Registration not found.'));
      }

      const previewToken = generateQrToken(app.config.QR_TOKEN_BYTES);
      const qrUrl = buildQrUrl(app.config.PUBLIC_URL, previewToken);
      const qrPngBytes = await renderQrPng(qrUrl);

      const pdfBytes = await renderInvitationPdf({
        eventName: registration.event.eventName,
        participantName: registration.name,
        registrationNo: registration.registrationNo,
        registeredCount: registration.registeredCount,
        eventDateLabel: formatEventDate(registration.event.eventDate),
        venue: registration.event.venue,
        instructions: registration.event.description,
        qrPngBytes,
      });

      const attachmentBytes = registration.category.inviteAttachmentData ?? registration.event.inviteAttachmentData;
      // Merge order: attachment (flyer/brochure) pages first, then the
      // generated ticket page(s) with the QR code - per the customer's
      // requested reading order (attachment first, QR/ticket last).
      const finalPdfBytes = attachmentBytes ? await mergePdfDocuments(attachmentBytes, pdfBytes) : pdfBytes;

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${invitationPdfFilename(registration.registrationNo)}"`)
        .send(Buffer.from(finalPdfBytes));
    },
  );
}
