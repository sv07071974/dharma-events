import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@dharma-events/database';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { createUserSchema } from '../auth/schemas.js';
import { hashPassword } from '../auth/password.js';
import { toPublicUser } from '../auth/public-user.js';
import { recordAuditLog } from '../auth/audit-log.js';

/**
 * Admin-only user management (REQUIREMENTS.md Section 3.1 - "Manage users
 * and roles"; Section 35 example - "POST /api/users ADMIN"). Broader event
 * management (categories, volunteers, events) lands in Phase 2.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/users', { preHandler: app.requireRole(Role.ADMIN) }, async () => {
    const users = await app.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return apiSuccess({ users: users.map(toPublicUser) });
  });

  app.post('/api/v1/users', { preHandler: app.requireRole(Role.ADMIN) }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
    }

    const { email, name, password, role } = parsed.data;
    const passwordHash = await hashPassword(password);

    try {
      const user = await app.prisma.user.create({
        data: { email, name, passwordHash, role },
      });

      await recordAuditLog(app.prisma, {
        userId: request.currentUser!.id,
        action: 'USER_CREATE',
        entityType: 'User',
        entityId: user.id,
        ipAddress: request.ip,
      });

      return reply.status(201).send(apiSuccess({ user: toPublicUser(user) }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply
          .status(409)
          .send(apiError('EMAIL_IN_USE', 'A user with this email address already exists.'));
      }
      throw err;
    }
  });
}
