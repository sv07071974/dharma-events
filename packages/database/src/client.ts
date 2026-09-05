import { PrismaClient } from '@prisma/client';

export {
  PrismaClient,
  Role,
  EventStatus,
  InvitationStatus,
  ValidationStatus,
  InvitationJobStatus,
  CheckinStatus,
  Prisma,
} from '@prisma/client';
export type {
  User,
  Session,
  AuditLog,
  Event,
  Category,
  Volunteer,
  Registration,
  InvitationJob,
  Checkin,
} from '@prisma/client';

/**
 * Shared PrismaClient singleton. Prevents exhausting PostgreSQL connections
 * from repeated client instantiation (e.g. during dev hot-reload).
 *
 * Accepts an explicit `databaseUrl` (rather than always relying on
 * `process.env.DATABASE_URL`) so callers - notably integration tests using an
 * ephemeral database - get a deterministic connection target instead of one
 * implicitly baked in from whatever `DATABASE_URL` happened to be set when
 * the singleton was first created.
 */
let client: PrismaClient | undefined;

export function getPrismaClient(databaseUrl?: string): PrismaClient {
  if (!client) {
    client = new PrismaClient(
      databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
    );
  }
  return client;
}

/** Test-only helper: forces a fresh PrismaClient on the next getPrismaClient() call. */
export async function resetPrismaClientForTests(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
