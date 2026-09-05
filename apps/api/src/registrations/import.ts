import * as XLSX from 'xlsx';
import type { StandardImportField } from './schemas.js';

/**
 * Excel/CSV import parsing and validation (REQUIREMENTS.md Section 15 -
 * Registration Import, Section 16 - Import Validation Rules, Section 17 -
 * Import Preview).
 *
 * Kept free of any Prisma/Fastify dependency so the parsing/validation logic
 * itself is easy to unit test; the route layer (`routes/import.ts`) supplies
 * the event-specific category/volunteer/duplicate lookups.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deliberately permissive - REQUIREMENTS.md Section 16 only asks to flag
// "malformed" numbers, not to enforce a specific national format.
const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;

const FIELD_HEADER_CANDIDATES: Record<StandardImportField, string[]> = {
  timestamp: ['timestamp', 'registered at', 'registration date'],
  email: ['email', 'email address'],
  name: ['participant name', 'name', 'full name'],
  whatsapp: ['whatsapp', 'whatsapp / mobile number', 'whatsapp mobile number', 'mobile', 'mobile number', 'phone'],
  attendees: ['no. of attendees', 'number of attendees', 'no of attendees', 'attendees'],
  category: ['category', 'participant / volunteer / event selection', 'participant volunteer event selection'],
  volunteerName: ['volunteer name'],
  volunteerEmail: ['volunteer email'],
};

/**
 * Builds a downloadable .xlsx bulk-import template using the same
 * canonical column headers `autoDetectMapping` recognizes below, so a file
 * filled in from this template auto-maps with zero manual configuration.
 * Includes one filled-in example row (using a real category from the
 * target event, when available) plus a second blank row ready to edit.
 */
export function buildImportTemplate(categoryNames: string[]): Buffer {
  const exampleCategory = categoryNames[0] ?? 'Participant';
  const headers = [
    'Timestamp',
    'Participant Name',
    'Email',
    'WhatsApp / Mobile Number',
    'No. of Attendees',
    'Category',
    'Volunteer Name',
    'Volunteer Email',
  ];
  const exampleRow = ['2026-01-15 10:30:00', 'Jane Doe', 'jane.doe@example.com', '+91 9876543210', '2', exampleCategory, '', ''];
  const blankRow = ['', '', '', '', '', '', '', ''];

  const sheet = XLSX.utils.aoa_to_sheet([headers, exampleRow, blankRow]);
  sheet['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 18) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Registrations');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Reads the first sheet of an .xlsx or .csv file buffer into row objects keyed by header. */
export function parseSpreadsheet(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }
  const sheet = workbook.Sheets[sheetName]!;
  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const headers = (headerRows[0] ?? []).map((h) => String(h ?? '').trim()).filter((h) => h.length > 0);

  const rows = objectRows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = value == null ? '' : String(value).trim();
    }
    return out;
  });

  return { headers, rows };
}

/** Best-effort column mapping guess based on common header name variants. */
export function autoDetectMapping(headers: string[]): Partial<Record<StandardImportField, string>> {
  const normalized = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));
  const mapping: Partial<Record<StandardImportField, string>> = {};

  for (const [field, candidates] of Object.entries(FIELD_HEADER_CANDIDATES) as [
    StandardImportField,
    string[],
  ][]) {
    const normalizedCandidates = candidates.map(normalizeHeader);
    const match = normalized.find((h) => normalizedCandidates.includes(h.normalized));
    if (match) {
      mapping[field] = match.original;
    }
  }

  return mapping;
}

export interface ExtractedRow {
  rowNumber: number;
  sourceTimestampRaw?: string;
  name?: string;
  email?: string;
  phone?: string;
  attendeesRaw?: string;
  categoryName?: string;
  volunteerName?: string;
  volunteerEmail?: string;
}

/** Applies a column mapping to a raw parsed row, extracting the standard fields. */
export function extractRow(
  row: Record<string, string>,
  mapping: Partial<Record<StandardImportField, string>>,
  rowNumber: number,
): ExtractedRow {
  const get = (field: StandardImportField): string | undefined => {
    const column = mapping[field];
    if (!column) return undefined;
    const value = row[column];
    return value === undefined || value === '' ? undefined : value;
  };

  return {
    rowNumber,
    sourceTimestampRaw: get('timestamp'),
    name: get('name')?.trim(),
    email: get('email')?.trim().toLowerCase(),
    phone: get('whatsapp')?.trim(),
    attendeesRaw: get('attendees')?.trim(),
    categoryName: get('category')?.trim(),
    volunteerName: get('volunteerName')?.trim(),
    volunteerEmail: get('volunteerEmail')?.trim().toLowerCase(),
  };
}

export type RowStatus = 'VALID' | 'WARNING' | 'ERROR';

export interface ValidatedRow extends ExtractedRow {
  status: RowStatus;
  errors: string[];
  warnings: string[];
  registeredCount?: number;
  categoryId?: string;
  sourceTimestamp?: Date;
}

/**
 * Validates a single extracted row (REQUIREMENTS.md Section 16). Missing
 * name/email, invalid email format, non-positive attendee counts, and
 * missing/unknown categories are treated as hard errors (the row is
 * excluded from import); malformed phone numbers are treated as warnings
 * (data-quality issue, not a rejection) - see docs/ASSUMPTIONS.md.
 */
export function validateRow(
  row: ExtractedRow,
  categoryIdByName: Map<string, string>,
): Pick<ValidatedRow, 'errors' | 'warnings' | 'registeredCount' | 'categoryId' | 'sourceTimestamp'> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.name) {
    errors.push('Missing participant name.');
  }

  if (!row.email) {
    errors.push('Missing participant email.');
  } else if (!EMAIL_RE.test(row.email)) {
    errors.push('Invalid participant email.');
  }

  let registeredCount: number | undefined;
  if (row.attendeesRaw === undefined) {
    errors.push('Missing number of attendees.');
  } else {
    const parsed = Number(row.attendeesRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.push('Number of attendees must be a positive number.');
    } else {
      registeredCount = Math.trunc(parsed);
    }
  }

  // Category is a soft requirement: rather than blocking the whole row,
  // an unrecognized or blank category is auto-resolved on commit (a new
  // category is created for an unrecognized name; blank falls back to a
  // shared "Uncategorized" category) - see commitImport. This is
  // surfaced as a warning here, not an error, so the row still imports.
  let categoryId: string | undefined;
  if (!row.categoryName) {
    warnings.push('No category specified - will be assigned to "Uncategorized".');
  } else {
    categoryId = categoryIdByName.get(row.categoryName.toLowerCase());
    if (!categoryId) {
      warnings.push(`New category "${row.categoryName}" will be created.`);
    }
  }

  if (row.volunteerEmail && !EMAIL_RE.test(row.volunteerEmail)) {
    errors.push('Invalid volunteer email.');
  }

  if (row.phone && !PHONE_RE.test(row.phone)) {
    warnings.push('Malformed phone number.');
  }

  let sourceTimestamp: Date | undefined;
  if (row.sourceTimestampRaw) {
    const parsed = new Date(row.sourceTimestampRaw);
    if (!Number.isNaN(parsed.getTime())) {
      sourceTimestamp = parsed;
    }
  }

  return { errors, warnings, registeredCount, categoryId, sourceTimestamp };
}

/**
 * Flags rows that duplicate another row's email or phone, either within the
 * same import batch or against registrations already in the database
 * (REQUIREMENTS.md Section 16 - "Duplicate email", "Duplicate phone",
 * "Duplicate name + email", "Duplicate registration rows"; Section 17 -
 * duplicates are warnings, not hard errors).
 */
export function detectDuplicates(
  rows: ExtractedRow[],
  existingEmails: Set<string>,
  existingPhones: Set<string>,
): { duplicateFlags: boolean[]; duplicateWarnings: string[][] } {
  const emailIndexes = new Map<string, number[]>();
  const phoneIndexes = new Map<string, number[]>();

  rows.forEach((row, index) => {
    if (row.email) {
      const list = emailIndexes.get(row.email) ?? [];
      list.push(index);
      emailIndexes.set(row.email, list);
    }
    if (row.phone) {
      const list = phoneIndexes.get(row.phone) ?? [];
      list.push(index);
      phoneIndexes.set(row.phone, list);
    }
  });

  const duplicateFlags = rows.map(() => false);
  const duplicateWarnings: string[][] = rows.map(() => []);

  for (const [email, indexes] of emailIndexes) {
    const duplicateInBatch = indexes.length > 1;
    const duplicateInDb = existingEmails.has(email);
    if (duplicateInBatch || duplicateInDb) {
      for (const index of indexes) {
        duplicateFlags[index] = true;
        duplicateWarnings[index]!.push(
          duplicateInDb
            ? 'Duplicate email: already registered for this event.'
            : 'Duplicate email within this import file.',
        );
      }
    }
  }

  for (const [phone, indexes] of phoneIndexes) {
    const duplicateInBatch = indexes.length > 1;
    const duplicateInDb = existingPhones.has(phone);
    if (duplicateInBatch || duplicateInDb) {
      for (const index of indexes) {
        duplicateFlags[index] = true;
        duplicateWarnings[index]!.push(
          duplicateInDb
            ? 'Duplicate mobile number: already registered for this event.'
            : 'Duplicate mobile number within this import file.',
        );
      }
    }
  }

  return { duplicateFlags, duplicateWarnings };
}
