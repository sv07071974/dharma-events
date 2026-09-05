import type { FastifyInstance } from 'fastify';
import type { Registration } from '@dharma-events/database';

/** Only VALID/OVERRIDE check-ins count towards attendance (Section 12.6/50); REVERSED rows are excluded. */
export const COUNTING_STATUSES = ['VALID', 'OVERRIDE'] as const;

export async function sumCheckedIn(
  prisma: FastifyInstance['prisma'],
  registrationId: string,
): Promise<number> {
  const agg = await prisma.checkin.aggregate({
    where: { registrationId, status: { in: [...COUNTING_STATUSES] } },
    _sum: { attendeeCount: true },
  });
  return agg._sum.attendeeCount ?? 0;
}

export function toScannerView(registration: Registration, categoryName: string, checkedInCount: number) {
  return {
    id: registration.id,
    registrationNo: registration.registrationNo,
    name: registration.name,
    category: categoryName,
    registeredCount: registration.registeredCount,
    checkedInCount,
    remainingCount: registration.registeredCount - checkedInCount,
  };
}
