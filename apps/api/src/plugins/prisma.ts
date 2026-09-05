import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getPrismaClient, type PrismaClient } from '@dharma-events/database';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  databaseUrl: string;
}

/**
 * Decorates the Fastify instance with a shared Prisma client and closes it
 * gracefully on server shutdown.
 */
export const prismaPlugin = fp<PrismaPluginOptions>(async (app: FastifyInstance, opts: PrismaPluginOptions) => {
  const prisma = getPrismaClient(opts.databaseUrl);
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
