import type { Prisma, PrismaClient } from '@dharma-events/database';

export interface AuditLogInput {
  eventId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Appends an audit log entry. Audit logs are append-only from the
 * application layer (REQUIREMENTS.md Section 12.8) - there is deliberately
 * no update/delete helper.
 */
export async function recordAuditLog(prisma: PrismaClient, input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      eventId: input.eventId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
