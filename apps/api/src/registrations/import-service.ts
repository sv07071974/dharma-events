import type { PrismaClient } from '@dharma-events/database';
import { formatRegistrationNumber } from '@dharma-events/shared';
import {
  autoDetectMapping,
  detectDuplicates,
  extractRow,
  parseSpreadsheet,
  validateRow,
  type RowStatus,
} from './import.js';
import type { ColumnMapping } from './schemas.js';

export interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  name?: string;
  email?: string;
  phone?: string;
  registeredCount?: number;
  categoryName?: string;
  volunteerName?: string;
  volunteerEmail?: string;
  errors: string[];
  warnings: string[];
}

export interface PreviewResult {
  totalRows: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  detectedMapping: ColumnMapping;
  rows: PreviewRow[];
}

/**
 * Builds validated preview rows from an uploaded file, without writing
 * anything to the database (REQUIREMENTS.md Section 17 - "No email or QR
 * generation should happen automatically after import" / "Preview must
 * never persist registrations").
 */
async function buildPreviewRows(
  prisma: PrismaClient,
  eventId: string,
  buffer: Buffer,
  mappingOverride?: ColumnMapping,
): Promise<{ mapping: ColumnMapping; validatedRows: PreviewRow[] }> {
  const { headers, rows } = parseSpreadsheet(buffer);
  const mapping = { ...autoDetectMapping(headers), ...(mappingOverride ?? {}) };

  const categories = await prisma.category.findMany({ where: { eventId, active: true } });
  const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const existingRegistrations = await prisma.registration.findMany({
    where: { eventId },
    select: { email: true, phone: true },
  });
  const existingEmails = new Set(existingRegistrations.map((r) => r.email.toLowerCase()));
  const existingPhones = new Set(
    existingRegistrations.map((r) => r.phone).filter((p): p is string => Boolean(p)),
  );

  const extracted = rows.map((row, index) => extractRow(row, mapping, index + 1));
  const { duplicateWarnings } = detectDuplicates(extracted, existingEmails, existingPhones);

  const validatedRows: PreviewRow[] = extracted.map((row, index) => {
    const validation = validateRow(row, categoryIdByName);
    const warnings = [...validation.warnings, ...duplicateWarnings[index]!];
    const status: RowStatus = validation.errors.length > 0 ? 'ERROR' : warnings.length > 0 ? 'WARNING' : 'VALID';

    return {
      rowNumber: row.rowNumber,
      status,
      name: row.name,
      email: row.email,
      phone: row.phone,
      registeredCount: validation.registeredCount,
      categoryName: row.categoryName,
      volunteerName: row.volunteerName,
      volunteerEmail: row.volunteerEmail,
      errors: validation.errors,
      warnings,
    };
  });

  return { mapping, validatedRows };
}

export async function previewImport(
  prisma: PrismaClient,
  eventId: string,
  buffer: Buffer,
  mappingOverride?: ColumnMapping,
): Promise<PreviewResult> {
  const { mapping, validatedRows } = await buildPreviewRows(prisma, eventId, buffer, mappingOverride);

  return {
    totalRows: validatedRows.length,
    validCount: validatedRows.filter((r) => r.status === 'VALID').length,
    warningCount: validatedRows.filter((r) => r.status === 'WARNING').length,
    errorCount: validatedRows.filter((r) => r.status === 'ERROR').length,
    detectedMapping: mapping,
    rows: validatedRows,
  };
}

export interface CommitResult {
  totalRows: number;
  importedCount: number;
  skippedErrorCount: number;
  warningCount: number;
}

/**
 * Re-validates the uploaded file (never trusting client-echoed row
 * decisions) and imports every non-error row inside a single database
 * transaction (REQUIREMENTS.md Section 44 - "Commit must use an import
 * transaction"). Registration numbers are assigned atomically per row via
 * `Event.registrationSeq` (see docs/ASSUMPTIONS.md for the concurrency
 * reasoning).
 */
export async function commitImport(
  prisma: PrismaClient,
  eventId: string,
  buffer: Buffer,
  mappingOverride: ColumnMapping | undefined,
  actorUserId: string,
  ipAddress: string | undefined,
): Promise<CommitResult> {
  const { validatedRows } = await buildPreviewRows(prisma, eventId, buffer, mappingOverride);
  const importableRows = validatedRows.filter((r) => r.status !== 'ERROR');

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const volunteers = await prisma.volunteer.findMany({ where: { eventId } });
  const volunteerIdByEmail = new Map(volunteers.map((v) => [v.email.toLowerCase(), v.id]));
  const categories = await prisma.category.findMany({ where: { eventId } });
  const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  // Category is never a hard blocker for import (see validateRow): any
  // category name in the file that doesn't already exist for this event is
  // created on the fly here, and rows with no category value at all fall
  // back to a shared "Uncategorized" category (created on demand too).
  const UNCATEGORIZED_NAME = 'Uncategorized';
  const missingNames = new Map<string, string>(); // lowercase key -> original casing
  let needsUncategorized = false;
  for (const row of importableRows) {
    if (!row.categoryName) {
      needsUncategorized = true;
    } else if (!categoryIdByName.has(row.categoryName.toLowerCase())) {
      missingNames.set(row.categoryName.toLowerCase(), row.categoryName);
    }
  }

  let importedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const [key, name] of missingNames) {
      if (categoryIdByName.has(key)) continue;
      const created = await tx.category.create({
        data: { eventId, name, sortOrder: categoryIdByName.size },
      });
      categoryIdByName.set(key, created.id);
    }
    if (needsUncategorized && !categoryIdByName.has(UNCATEGORIZED_NAME.toLowerCase())) {
      const created = await tx.category.create({
        data: { eventId, name: UNCATEGORIZED_NAME, sortOrder: categoryIdByName.size },
      });
      categoryIdByName.set(UNCATEGORIZED_NAME.toLowerCase(), created.id);
    }

    for (const row of importableRows) {
      // Atomic per-row increment: Postgres serializes concurrent UPDATEs to
      // the same row, so this is safe even if two imports for the same
      // event somehow ran at once.
      const updated = await tx.event.update({
        where: { id: eventId },
        data: { registrationSeq: { increment: 1 } },
      });
      const registrationNo = formatRegistrationNumber(event.eventCode, updated.registrationSeq);
      const categoryId = row.categoryName
        ? categoryIdByName.get(row.categoryName.toLowerCase())
        : categoryIdByName.get(UNCATEGORIZED_NAME.toLowerCase());
      const volunteerId = row.volunteerEmail ? volunteerIdByEmail.get(row.volunteerEmail) : undefined;

      await tx.registration.create({
        data: {
          eventId,
          registrationNo,
          name: row.name!,
          email: row.email!,
          phone: row.phone,
          registeredCount: row.registeredCount!,
          categoryId: categoryId!,
          volunteerId: volunteerId ?? null,
          duplicateFlag: row.warnings.length > 0,
          validationStatus: row.status,
          notes: row.warnings.length > 0 ? row.warnings.join(' ') : undefined,
        },
      });
      importedCount += 1;
    }

    await tx.auditLog.create({
      data: {
        eventId,
        userId: actorUserId,
        action: 'IMPORT_COMMIT',
        entityType: 'Registration',
        metadata: {
          totalRows: validatedRows.length,
          importedCount,
          skippedErrorCount: validatedRows.length - importableRows.length,
        },
        ipAddress: ipAddress ?? null,
      },
    });
  });

  return {
    totalRows: validatedRows.length,
    importedCount,
    skippedErrorCount: validatedRows.length - importableRows.length,
    warningCount: validatedRows.filter((r) => r.status === 'WARNING').length,
  };
}
