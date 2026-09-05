import * as XLSX from 'xlsx';

export type ReportFormat = 'json' | 'csv' | 'xlsx';

/** Reads and validates the `?format=` query param (Section 32 - CSV/XLSX export, JSON default for the frontend). */
export function parseFormat(raw: unknown): ReportFormat {
  if (raw === 'csv' || raw === 'xlsx') return raw;
  return 'json';
}

/**
 * Serializes a flat array of report rows to CSV or XLSX bytes using the
 * `xlsx` package already used for import parsing (REQUIREMENTS.md Section
 * 32 - "CSV" and "XLSX where practical").
 */
export function serializeReport(rows: Record<string, unknown>[], format: 'csv' | 'xlsx'): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (format === 'csv') {
    return Buffer.from(XLSX.utils.sheet_to_csv(sheet), 'utf-8');
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function contentTypeFor(format: 'csv' | 'xlsx'): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
