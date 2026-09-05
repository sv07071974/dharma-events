import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@dharma-events/database';
import type { Env } from '@dharma-events/shared';
import { apiError } from '@dharma-events/shared';
import { resolveSessionUser } from '../auth/session-service.js';
import { roleSatisfies } from '../auth/rbac.js';
import type { Role } from '@dharma-events/database';

export const SESSION_COOKIE_NAME = 'dharma_session';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      minimumRole: Role,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOptions {
  env: Env;
}

/**
 * Wires up the session-cookie authentication layer:
 *  - Parses/verifies the session cookie on every request (best-effort;
 *    never rejects by itself so public routes like /auth/login still work).
 *  - Exposes `app.authenticate` as a preHandler that rejects anonymous
 *    requests (REQUIREMENTS.md Section 75 - "Protected APIs reject anonymous
 *    users").
 *  - Exposes `app.requireRole(minimumRole)` as a preHandler implementing the
 *    "ROLE+" authorization rules from Section 35.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, opts: AuthPluginOptions) => {
  await app.register(cookie);

  app.decorateRequest('currentUser', null);

  app.addHook('preHandler', async (request) => {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    request.currentUser = await resolveSessionUser(app.prisma, rawToken);
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      return reply
        .status(401)
        .send(apiError('UNAUTHENTICATED', 'You must be logged in to perform this action.'));
    }
  });

  app.decorate('requireRole', (minimumRole: Role) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.currentUser) {
        return reply
          .status(401)
          .send(apiError('UNAUTHENTICATED', 'You must be logged in to perform this action.'));
      }
      if (!roleSatisfies(request.currentUser.role, minimumRole)) {
        return reply
          .status(403)
          .send(apiError('FORBIDDEN', 'You do not have permission to perform this action.'));
      }
    };
  });

  // Keep the configured env (session TTL, cookie security flags) reachable
  // from route handlers without re-parsing process.env.
  app.decorate('config', opts.env);
});

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}
