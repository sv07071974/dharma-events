import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma, Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { createCategorySchema, updateCategorySchema } from '../events/schemas.js';
import { recordAuditLog } from '../auth/audit-log.js';

// Excludes `inviteAttachmentData` (raw PDF bytes) from every JSON category
// response - mirrors `eventSelect` in routes/events.ts for the same reason.
const categorySelect = {
  id: true,
  eventId: true,
  name: true,
  description: true,
  active: true,
  sortOrder: true,
  inviteAttachmentFilename: true,
  inviteAttachmentSize: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

const MAX_INVITE_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB - generous for a flyer/brochure PDF.

/**
 * Category CRUD, scoped per event (REQUIREMENTS.md Section 41 - Category
 * APIs; Section 12.3 - categories must be configurable per event).
 */
export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/events/:eventId/categories',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const categories = await app.prisma.category.findMany({
        where: { eventId },
        orderBy: { sortOrder: 'asc' },
        select: categorySelect,
      });
      return apiSuccess({ categories });
    },
  );

  app.post(
    '/api/v1/events/:eventId/categories',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      try {
        const category = await app.prisma.category.create({
          data: { ...parsed.data, eventId },
          select: categorySelect,
        });

        await recordAuditLog(app.prisma, {
          eventId,
          userId: request.currentUser!.id,
          action: 'CATEGORY_CREATE',
          entityType: 'Category',
          entityId: category.id,
          ipAddress: request.ip,
        });

        return reply.status(201).send(apiSuccess({ category }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply
            .status(409)
            .send(apiError('CATEGORY_NAME_IN_USE', 'A category with this name already exists for this event.'));
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/v1/categories/:categoryId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { categoryId } = request.params as { categoryId: string };
      const existing = await app.prisma.category.findUnique({ where: { id: categoryId } });
      if (!existing) {
        return reply.status(404).send(apiError('CATEGORY_NOT_FOUND', 'Category not found.'));
      }

      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      try {
        const category = await app.prisma.category.update({
          where: { id: categoryId },
          data: parsed.data,
          select: categorySelect,
        });

        await recordAuditLog(app.prisma, {
          eventId: category.eventId,
          userId: request.currentUser!.id,
          action: 'CATEGORY_UPDATE',
          entityType: 'Category',
          entityId: category.id,
          metadata: parsed.data as Prisma.InputJsonValue,
          ipAddress: request.ip,
        });

        return apiSuccess({ category });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply
            .status(409)
            .send(apiError('CATEGORY_NAME_IN_USE', 'A category with this name already exists for this event.'));
        }
        throw err;
      }
    },
  );

  // Soft-delete (active = false) rather than a hard delete, so categories
  // already referenced by registrations in later phases are never orphaned
  // (documented assumption - mirrors the event soft-delete/archive pattern).
  app.delete(
    '/api/v1/categories/:categoryId',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { categoryId } = request.params as { categoryId: string };
      const existing = await app.prisma.category.findUnique({ where: { id: categoryId } });
      if (!existing) {
        return reply.status(404).send(apiError('CATEGORY_NOT_FOUND', 'Category not found.'));
      }

      const category = await app.prisma.category.update({
        where: { id: categoryId },
        data: { active: false },
        select: categorySelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: category.eventId,
        userId: request.currentUser!.id,
        action: 'CATEGORY_DEACTIVATE',
        entityType: 'Category',
        entityId: category.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ category });
    },
  );

  /**
   * Uploads (or replaces) a category-specific invite attachment PDF - lets
   * an event use different invite templates per category (e.g. "VIP" vs
   * "General") instead of just one common event-wide attachment. When
   * present, this takes priority over the event's `inviteAttachmentData`
   * for registrations in this category (see apps/worker/src/invitation-worker.ts).
   */
  app.post(
    '/api/v1/categories/:categoryId/invite-attachment',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { categoryId } = request.params as { categoryId: string };
      const existing = await app.prisma.category.findUnique({ where: { id: categoryId } });
      if (!existing) {
        return reply.status(404).send(apiError('CATEGORY_NOT_FOUND', 'Category not found.'));
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

      const category = await app.prisma.category.update({
        where: { id: categoryId },
        data: {
          inviteAttachmentData: buffer,
          inviteAttachmentFilename: file.filename,
          inviteAttachmentSize: buffer.byteLength,
        },
        select: categorySelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: category.eventId,
        userId: request.currentUser!.id,
        action: 'CATEGORY_INVITE_ATTACHMENT_UPLOAD',
        entityType: 'Category',
        entityId: category.id,
        metadata: { filename: file.filename, size: buffer.byteLength },
        ipAddress: request.ip,
      });

      return apiSuccess({ category });
    },
  );

  /** Streams the raw category invite attachment PDF back (used for the "View" link in the web UI). */
  app.get(
    '/api/v1/categories/:categoryId/invite-attachment',
    { preHandler: app.requireRole(Role.VOLUNTEER) },
    async (request, reply) => {
      const { categoryId } = request.params as { categoryId: string };
      const category = await app.prisma.category.findUnique({
        where: { id: categoryId },
        select: { inviteAttachmentData: true, inviteAttachmentFilename: true },
      });
      if (!category?.inviteAttachmentData) {
        return reply.status(404).send(apiError('INVITE_ATTACHMENT_NOT_FOUND', 'No invite attachment uploaded.'));
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="${category.inviteAttachmentFilename ?? 'invite-attachment.pdf'}"`,
        )
        .send(category.inviteAttachmentData);
    },
  );

  app.delete(
    '/api/v1/categories/:categoryId/invite-attachment',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { categoryId } = request.params as { categoryId: string };
      const existing = await app.prisma.category.findUnique({ where: { id: categoryId } });
      if (!existing) {
        return reply.status(404).send(apiError('CATEGORY_NOT_FOUND', 'Category not found.'));
      }

      const category = await app.prisma.category.update({
        where: { id: categoryId },
        data: { inviteAttachmentData: null, inviteAttachmentFilename: null, inviteAttachmentSize: null },
        select: categorySelect,
      });

      await recordAuditLog(app.prisma, {
        eventId: category.eventId,
        userId: request.currentUser!.id,
        action: 'CATEGORY_INVITE_ATTACHMENT_REMOVE',
        entityType: 'Category',
        entityId: category.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ category });
    },
  );
}
