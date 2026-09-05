import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { apiError, apiSuccess, type Env } from '@dharma-events/shared';
import { prismaPlugin } from './plugins/prisma.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { eventRoutes } from './routes/events.js';
import { categoryRoutes } from './routes/categories.js';
import { volunteerRoutes } from './routes/volunteers.js';
import { registrationRoutes } from './routes/registrations.js';
import { importRoutes } from './routes/import.js';
import { invitationRoutes } from './routes/invitations.js';
import { checkinRoutes } from './routes/checkins.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { reportRoutes } from './routes/reports.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the error handler for the Section 61 structured access log. */
    errorType: string | null;
  }
}

/**
 * Builds the Fastify application without starting the network listener.
 * Kept separate from server.ts so integration tests can use `.inject()`.
 */
export function buildApp(env: Env): FastifyInstance {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    // Section 61 requires structured logs with a specific field set
    // (requestId/route/httpStatus/userId/duration/errorType). Fastify's
    // built-in access log doesn't include userId or errorType, so it's
    // disabled here in favour of the onResponse hook below, which emits
    // exactly those fields and nothing else (never request/response
    // bodies, so passwords/SMTP credentials/QR tokens/auth tokens are
    // never at risk of being logged).
    disableRequestLogging: true,
  });

  // Section 82: security headers. CSP is left at helmet's conservative
  // default (deny-by-default with self-only) since the SPA is served by
  // Nginx from the same origin as the API in production; HSTS is disabled
  // here because HTTPS termination happens at the Synology reverse proxy,
  // not in the API container itself (Section 57).
  app.register(helmet, {
    global: true,
    hsts: false,
  });

  app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  app.register(prismaPlugin, { databaseUrl: env.DATABASE_URL });
  app.register(authPlugin, { env });
  app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB - generous for a spreadsheet import
  });

  app.decorateRequest('errorType', null);

  // Section 61: structured JSON access log - requestId, route, httpStatus,
  // userId, duration, errorType. Deliberately omits request/response
  // bodies and headers so credentials, QR tokens, and auth tokens can
  // never leak into logs.
  app.addHook('onResponse', async (request, reply) => {
    app.log.info({
      requestId: request.id,
      route: request.routeOptions.url ?? request.url,
      method: request.method,
      httpStatus: reply.statusCode,
      userId: request.currentUser?.id ?? null,
      durationMs: reply.elapsedTime,
      errorType: request.errorType,
    });
  });

  app.get('/api/health', async () => {
    return apiSuccess({
      status: 'ok',
      service: 'dharma-events-api',
      timestamp: new Date().toISOString(),
    });
  });

  // Section 62: readiness = DB reachable + required config present. Unlike
  // /api/health (process is running), this is what Docker/Synology should
  // treat as "safe to route traffic to" and is the healthcheck compose.yml
  // uses to gate the api container's healthy state.
  app.get('/api/ready', async (_request, reply) => {
    const requiredConfig: Array<[string, unknown]> = [
      ['DATABASE_URL', env.DATABASE_URL],
      ['SESSION_SECRET', env.SESSION_SECRET],
    ];
    const missingConfig = requiredConfig
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingConfig.length > 0) {
      return reply.status(503).send(
        apiError('NOT_READY', `Required configuration is missing: ${missingConfig.join(', ')}`),
      );
    }

    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.status(503).send(
        apiError('NOT_READY', 'Database is not reachable'),
      );
    }

    return apiSuccess({
      status: 'ready',
      service: 'dharma-events-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.register(authRoutes);
  app.register(userRoutes);
  app.register(eventRoutes);
  app.register(categoryRoutes);
  app.register(volunteerRoutes);
  app.register(registrationRoutes);
  app.register(importRoutes);
  app.register(invitationRoutes);
  app.register(checkinRoutes);
  app.register(dashboardRoutes);
  app.register(reportRoutes);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(apiError('NOT_FOUND', 'The requested resource was not found.'));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.errorType = error.name ?? error.code ?? 'Error';
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(error);
      reply.status(500).send(apiError('INTERNAL_ERROR', 'Something went wrong. Please retry.'));
      return;
    }
    // 4xx errors (validation, rate limit, etc.) still carry a useful message.
    reply.status(statusCode).send(apiError(error.code ?? 'REQUEST_ERROR', error.message));
  });

  return app;
}
