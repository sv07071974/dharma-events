import type { FastifyInstance } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import { Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { columnMappingSchema, type ColumnMapping } from '../registrations/schemas.js';
import { previewImport, commitImport } from '../registrations/import-service.js';
import { buildImportTemplate } from '../registrations/import.js';

interface ImportRequestBody {
  file?: MultipartFile;
  mapping?: MultipartValue<string>;
}

async function readUpload(
  request: { body: unknown },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
): Promise<{ buffer: Buffer; mapping?: ColumnMapping } | undefined> {
  const body = request.body as ImportRequestBody | undefined;
  const file = body?.file;
  if (!file) {
    reply.status(400).send(apiError('VALIDATION_ERROR', 'A .xlsx or .csv file upload is required.'));
    return undefined;
  }

  const buffer = await file.toBuffer();

  let mapping: ColumnMapping | undefined;
  if (body?.mapping?.value) {
    try {
      const parsedJson: unknown = JSON.parse(body.mapping.value);
      const parsedMapping = columnMappingSchema.safeParse(parsedJson);
      if (!parsedMapping.success) {
        reply.status(400).send(apiError('VALIDATION_ERROR', 'Invalid column mapping.'));
        return undefined;
      }
      mapping = parsedMapping.data;
    } catch {
      reply.status(400).send(apiError('VALIDATION_ERROR', 'Column mapping must be valid JSON.'));
      return undefined;
    }
  }

  return { buffer, mapping };
}

/**
 * Registration import - preview and commit (REQUIREMENTS.md Section 44 -
 * Import APIs; Section 15-17). Preview never writes to the database; commit
 * runs inside a single transaction (see registrations/import-service.ts).
 */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/events/:eventId/import/template',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const categories = await app.prisma.category.findMany({
        where: { eventId, active: true },
        orderBy: { sortOrder: 'asc' },
        select: { name: true },
      });

      const buffer = buildImportTemplate(categories.map((c) => c.name));
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${event.eventCode}-import-template.xlsx"`)
        .send(buffer);
    },
  );

  app.post(
    '/api/v1/events/:eventId/import/preview',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const upload = await readUpload(request, reply);
      if (!upload) return;

      const result = await previewImport(app.prisma, eventId, upload.buffer, upload.mapping);
      return apiSuccess(result);
    },
  );

  app.post(
    '/api/v1/events/:eventId/import/commit',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await app.prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const upload = await readUpload(request, reply);
      if (!upload) return;

      const result = await commitImport(
        app.prisma,
        eventId,
        upload.buffer,
        upload.mapping,
        request.currentUser!.id,
        request.ip,
      );
      return apiSuccess(result);
    },
  );
}
