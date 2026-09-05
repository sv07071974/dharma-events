import type { FastifyInstance } from 'fastify';
import { apiError, apiSuccess } from '@dharma-events/shared';
import { loginSchema } from '../auth/schemas.js';
import { verifyPassword } from '../auth/password.js';
import { createSession, destroySession } from '../auth/session-service.js';
import { toPublicUser } from '../auth/public-user.js';
import { recordAuditLog } from '../auth/audit-log.js';
import { SESSION_COOKIE_NAME } from '../plugins/auth.js';

const GENERIC_INVALID_CREDENTIALS = 'The email or password you entered is incorrect.';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: app.config.LOGIN_RATE_LIMIT_MAX,
          timeWindow: app.config.LOGIN_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.'));
      }

      const { email, password } = parsed.data;
      const user = await app.prisma.user.findUnique({ where: { email } });

      if (!user || !user.active) {
        return reply.status(401).send(apiError('INVALID_CREDENTIALS', GENERIC_INVALID_CREDENTIALS));
      }

      const passwordValid = await verifyPassword(user.passwordHash, password);
      if (!passwordValid) {
        return reply.status(401).send(apiError('INVALID_CREDENTIALS', GENERIC_INVALID_CREDENTIALS));
      }

      const { rawToken, expiresAt } = await createSession(
        app.prisma,
        user.id,
        app.config.SESSION_TTL_HOURS,
        { ipAddress: request.ip, userAgent: request.headers['user-agent'] },
      );

      reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure: app.config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });

      await recordAuditLog(app.prisma, {
        userId: user.id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        ipAddress: request.ip,
      });

      return apiSuccess({ user: toPublicUser(user) });
    },
  );

  app.post('/api/v1/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    if (rawToken) {
      await destroySession(app.prisma, rawToken);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

    await recordAuditLog(app.prisma, {
      userId: request.currentUser?.id,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: request.currentUser?.id,
      ipAddress: request.ip,
    });

    return apiSuccess({});
  });

  app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request) => {
    return apiSuccess({ user: toPublicUser(request.currentUser!) });
  });
}
