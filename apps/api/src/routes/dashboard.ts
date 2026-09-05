import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { COUNTING_STATUSES } from '../checkins/helpers.js';

/**
 * Dashboard APIs (REQUIREMENTS.md Sections 29-31, 48 - Phase 7).
 *
 * All routes require SUPERVISOR+ (Section 3.3 - "View operational
 * dashboard" is a Supervisor capability; Event Manager/Admin outrank
 * Supervisor so they can view it too). The frontend polls these every 5
 * seconds (Section 31) rather than using WebSockets.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  async function requireEvent(eventId: string) {
    return app.prisma.event.findUnique({ where: { id: eventId } });
  }

  app.get(
    '/api/v1/events/:eventId/dashboard/summary',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        select: { id: true, registeredCount: true },
      });
      const totalCapacity = registrations.reduce((sum, r) => sum + r.registeredCount, 0);

      const checkedInByRegistration = await app.prisma.checkin.groupBy({
        by: ['registrationId'],
        where: { eventId, status: { in: [...COUNTING_STATUSES] } },
        _sum: { attendeeCount: true },
      });
      const checkedInMap = new Map(checkedInByRegistration.map((c) => [c.registrationId, c._sum.attendeeCount ?? 0]));

      let totalArrived = 0;
      let fullyCheckedIn = 0;
      let partiallyCheckedIn = 0;
      let notArrived = 0;
      for (const registration of registrations) {
        const arrived = checkedInMap.get(registration.id) ?? 0;
        totalArrived += arrived;
        if (arrived <= 0) {
          notArrived += 1;
        } else if (arrived >= registration.registeredCount) {
          fullyCheckedIn += 1;
        } else {
          partiallyCheckedIn += 1;
        }
      }

      return apiSuccess({
        totalRegistrations: registrations.length,
        totalCapacity,
        totalArrived,
        remaining: totalCapacity - totalArrived,
        attendancePercentage: totalCapacity > 0 ? Number(((totalArrived / totalCapacity) * 100).toFixed(1)) : 0,
        fullyCheckedIn,
        partiallyCheckedIn,
        notArrived,
      });
    },
  );

  app.get(
    '/api/v1/events/:eventId/dashboard/categories',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const registrations = await app.prisma.registration.findMany({
        where: { eventId },
        select: { id: true, registeredCount: true, categoryId: true, category: { select: { name: true } } },
      });
      const checkedInByRegistration = await app.prisma.checkin.groupBy({
        by: ['registrationId'],
        where: { eventId, status: { in: [...COUNTING_STATUSES] } },
        _sum: { attendeeCount: true },
      });
      const checkedInMap = new Map(checkedInByRegistration.map((c) => [c.registrationId, c._sum.attendeeCount ?? 0]));

      const byCategory = new Map<string, { name: string; registered: number; arrived: number }>();
      for (const registration of registrations) {
        const bucket = byCategory.get(registration.categoryId) ?? {
          name: registration.category.name,
          registered: 0,
          arrived: 0,
        };
        bucket.registered += registration.registeredCount;
        bucket.arrived += checkedInMap.get(registration.id) ?? 0;
        byCategory.set(registration.categoryId, bucket);
      }

      return apiSuccess({
        categories: [...byCategory.entries()].map(([categoryId, v]) => ({ categoryId, ...v })),
      });
    },
  );

  app.get(
    '/api/v1/events/:eventId/dashboard/volunteers',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      // "By Volunteer" (Section 30) attributes check-ins to the logged-in
      // staff account that performed them (`Checkin.checkedById`), not the
      // `volunteers` roster table (Section 12.4), which has no relation to
      // individual check-in transactions.
      const byChecker = await app.prisma.checkin.groupBy({
        by: ['checkedById'],
        where: { eventId, status: { in: [...COUNTING_STATUSES] } },
        _sum: { attendeeCount: true },
        _count: { _all: true },
      });
      const userIds = byChecker.map((c) => c.checkedById);
      const users = await app.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
      const userNameMap = new Map(users.map((u) => [u.id, u.name]));

      return apiSuccess({
        volunteers: byChecker
          .map((c) => ({
            userId: c.checkedById,
            name: userNameMap.get(c.checkedById) ?? 'Unknown',
            checkedInCount: c._sum.attendeeCount ?? 0,
            checkinTransactions: c._count._all,
          }))
          .sort((a, b) => b.checkedInCount - a.checkedInCount),
      });
    },
  );

  app.get(
    '/api/v1/events/:eventId/dashboard/timeline',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
      if (!event) {
        return reply.status(404).send(apiError('EVENT_NOT_FOUND', 'Event not found.'));
      }

      const rows = await app.prisma.$queryRaw<{ hour: Date; total: bigint }[]>(Prisma.sql`
        SELECT date_trunc('hour', checked_in_at) AS hour, SUM(attendee_count) AS total
        FROM checkins
        WHERE event_id = ${eventId} AND status IN ('VALID', 'OVERRIDE')
        GROUP BY hour
        ORDER BY hour ASC
      `);

      return apiSuccess({
        timeline: rows.map((r) => ({ hour: r.hour.toISOString(), attendeeCount: Number(r.total) })),
      });
    },
  );

  app.get(
    '/api/v1/events/:eventId/dashboard/recent',
    { preHandler: app.requireRole(Role.SUPERVISOR) },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const event = await requireEvent(eventId);
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
}
