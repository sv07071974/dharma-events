import type { FastifyInstance, FastifyReply } from 'fastify';
import { Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { COUNTING_STATUSES } from '../checkins/helpers.js';
import { parseFormat, serializeReport, contentTypeFor } from '../reports/export.js';

/**
 * Report APIs (REQUIREMENTS.md Sections 32, 49 - Phase 7). Section 49
 * lists exactly four report endpoints (attendance/no-show/checkins/
 * invitations); Section 32's longer list of report *types* (registration
 * list, partially-checked-in, volunteer assignment, failed-invitation,
 * audit) is not matched by a literal API route and is treated the same
 * way Phase 4/5 treated similar spec/API-list mismatches - the four
 * routes below are implemented as specified, and the extra report types
 * are a documented gap (see docs/ASSUMPTIONS.md). Every route requires
 * EVENT_MANAGER+ (Section 3.2/3.1 - "View event reports" / "Export
 * attendance reports") and supports `?format=csv|xlsx` in addition to the
 * JSON default.
 */
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  async function requireEvent(eventId: string) {
    return app.prisma.event.findUnique({ where: { id: eventId } });
  }

  function sendReport(
    reply: FastifyReply,
    rows: Record<string, unknown>[],
    format: 'json' | 'csv' | 'xlsx',
    filename: string,
  ) {
    if (format === 'json') {
      return apiSuccess({ rows });
    }
    const buffer = serializeReport(rows, format);
    return reply
      .header('Content-Type', contentTypeFor(format))
      .header('Content-Disposition', `attachment; filename="${filename}.${format}"`)
      .send(buffer);
  }

  app.get(
    '/api/v1/events/:eventId/reports/attendance',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }
      const format = parseFormat((request.query as { format?: string }).format);

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        include: { category: true },
        orderBy: { registrationNo: 'asc' },
      });
      const checkedInByRegistration = await app.prisma.checkin.groupBy({
        by: ['registrationId'],
        where: { eventId, status: { in: [...COUNTING_STATUSES] } },
        _sum: { attendeeCount: true },
      });
      const checkedInMap = new Map(checkedInByRegistration.map((c) => [c.registrationId, c._sum.attendeeCount ?? 0]));

      const rows = registrations.map((r) => {
        const checkedInCount = checkedInMap.get(r.id) ?? 0;
        const status =
          checkedInCount <= 0 ? 'NOT_ARRIVED' : checkedInCount >= r.registeredCount ? 'FULLY_CHECKED_IN' : 'PARTIALLY_CHECKED_IN';
        return {
          registrationNo: r.registrationNo,
          name: r.name,
          category: r.category.name,
          registeredCount: r.registeredCount,
          checkedInCount,
          remainingCount: r.registeredCount - checkedInCount,
          status,
        };
      });

      return sendReport(reply, rows, format, `attendance-${event.eventCode}`);
    },
  );

  app.get(
    '/api/v1/events/:eventId/reports/no-show',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }
      const format = parseFormat((request.query as { format?: string }).format);

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        include: { category: true },
        orderBy: { registrationNo: 'asc' },
      });
      const checkedInIds = new Set(
        (
          await app.prisma.checkin.groupBy({
            by: ['registrationId'],
            where: { eventId, status: { in: [...COUNTING_STATUSES] } },
            _sum: { attendeeCount: true },
          })
        )
          .filter((c) => (c._sum.attendeeCount ?? 0) > 0)
          .map((c) => c.registrationId),
      );

      const rows = registrations
        .filter((r) => !checkedInIds.has(r.id))
        .map((r) => ({
          registrationNo: r.registrationNo,
          name: r.name,
          email: r.email,
          phone: r.phone ?? '',
          category: r.category.name,
          registeredCount: r.registeredCount,
        }));

      return sendReport(reply, rows, format, `no-show-${event.eventCode}`);
    },
  );

  app.get(
    '/api/v1/events/:eventId/reports/checkins',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }
      const format = parseFormat((request.query as { format?: string }).format);

      const checkins = await app.prisma.checkin.findMany({
        where: { eventId },
        include: { registration: true, checkedBy: { select: { name: true } } },
        orderBy: { checkedInAt: 'asc' },
      });

      const rows = checkins.map((c) => ({
        checkedInAt: c.checkedInAt.toISOString(),
        registrationNo: c.registration.registrationNo,
        name: c.registration.name,
        attendeeCount: c.attendeeCount,
        status: c.status,
        checkedBy: c.checkedBy.name,
        counterName: c.counterName ?? '',
        notes: c.notes ?? '',
      }));

      return sendReport(reply, rows, format, `checkins-${event.eventCode}`);
    },
  );

  app.get(
    '/api/v1/events/:eventId/reports/invitations',
    { preHandler: app.requireRole(Role.EVENT_MANAGER) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }
      const format = parseFormat((request.query as { format?: string }).format);

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        orderBy: { registrationNo: 'asc' },
      });
      const latestJobs = await app.prisma.invitationJob.findMany({
        where: { eventId },
        orderBy: { createdAt: 'desc' },
      });
      const latestJobByRegistration = new Map<string, (typeof latestJobs)[number]>();
      for (const job of latestJobs) {
        if (!latestJobByRegistration.has(job.registrationId)) {
          latestJobByRegistration.set(job.registrationId, job);
        }
      }

      const rows = registrations.map((r) => {
        const job = latestJobByRegistration.get(r.id);
        return {
          registrationNo: r.registrationNo,
          name: r.name,
          email: r.email,
          invitationStatus: r.invitationStatus,
          invitationSentAt: r.invitationSentAt ? r.invitationSentAt.toISOString() : '',
          lastAttemptAt: job?.lastAttemptAt ? job.lastAttemptAt.toISOString() : '',
          attemptCount: job?.attemptCount ?? 0,
          errorMessage: job?.errorMessage ?? '',
        };
      });

      return sendReport(reply, rows, format, `invitations-${event.eventCode}`);
    },
  );
}
