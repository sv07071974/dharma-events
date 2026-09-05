import { describe, expect, it } from 'vitest';
import {
  autoDetectMapping,
  buildImportTemplate,
  detectDuplicates,
  extractRow,
  parseSpreadsheet,
  validateRow,
} from '../src/registrations/import.js';

describe('autoDetectMapping', () => {
  it('maps the standardized source-sheet headers from REQUIREMENTS.md Section 5', () => {
    const headers = [
      'Timestamp',
      'Email',
      'Participant Name',
      'WhatsApp',
      'No. of Attendees',
      'Category',
      'Volunteer Name',
      'Volunteer Email',
    ];

    expect(autoDetectMapping(headers)).toEqual({
      timestamp: 'Timestamp',
      email: 'Email',
      name: 'Participant Name',
      whatsapp: 'WhatsApp',
      attendees: 'No. of Attendees',
      category: 'Category',
      volunteerName: 'Volunteer Name',
      volunteerEmail: 'Volunteer Email',
    });
  });

  it('leaves unmapped fields absent when no header matches', () => {
    const mapping = autoDetectMapping(['Some Random Column']);
    expect(mapping.email).toBeUndefined();
    expect(mapping.name).toBeUndefined();
  });
});

describe('buildImportTemplate', () => {
  it('produces an .xlsx whose headers auto-detect to every standard import field', () => {
    const buffer = buildImportTemplate(['VIP']);
    const { headers, rows } = parseSpreadsheet(buffer);

    expect(autoDetectMapping(headers)).toEqual({
      timestamp: 'Timestamp',
      email: 'Email',
      name: 'Participant Name',
      whatsapp: 'WhatsApp / Mobile Number',
      attendees: 'No. of Attendees',
      category: 'Category',
      volunteerName: 'Volunteer Name',
      volunteerEmail: 'Volunteer Email',
    });
    // First data row is a filled-in example using the given category name.
    expect(rows[0]?.Category).toBe('VIP');
    // Second data row is left blank for the user to fill in.
    expect(rows[1]?.['Participant Name']).toBe('');
  });

  it('falls back to a generic category name when the event has none', () => {
    const buffer = buildImportTemplate([]);
    const { rows } = parseSpreadsheet(buffer);
    expect(rows[0]?.Category).toBe('Participant');
  });
});

describe('parseSpreadsheet', () => {
  it('parses a CSV buffer into header/row objects', () => {
    const csv = 'Name,Email\nJane Doe,jane@example.test\nJohn Doe,john@example.test\n';
    const { headers, rows } = parseSpreadsheet(Buffer.from(csv));

    expect(headers).toEqual(['Name', 'Email']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: 'Jane Doe', Email: 'jane@example.test' });
  });
});

describe('validateRow', () => {
  const categoryIdByName = new Map([['participant', 'category-id-1']]);

  it('flags a fully valid row with no errors or warnings', () => {
    const row = extractRow(
      { Name: 'Jane Doe', Email: 'jane@example.test', Attendees: '2', Category: 'Participant' },
      { name: 'Name', email: 'Email', attendees: 'Attendees', category: 'Category' },
      1,
    );
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toEqual([]);
    expect(result.registeredCount).toBe(2);
    expect(result.categoryId).toBe('category-id-1');
  });

  it('reports missing name, missing email, and missing attendee count', () => {
    const row = extractRow({}, {}, 1);
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toContain('Missing participant name.');
    expect(result.errors).toContain('Missing participant email.');
    expect(result.errors).toContain('Missing number of attendees.');
    expect(result.warnings).toContain('No category specified - will be assigned to "Uncategorized".');
  });

  it('rejects an invalid email format', () => {
    const row = extractRow({ Email: 'not-an-email' }, { email: 'Email' }, 1);
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toContain('Invalid participant email.');
  });

  it('rejects a non-positive attendee count', () => {
    const row = extractRow({ Attendees: '0' }, { attendees: 'Attendees' }, 1);
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toContain('Number of attendees must be a positive number.');
  });

  it('warns (does not error) on an unknown category, since it will be auto-created on commit', () => {
    const row = extractRow(
      { Name: 'Jane Doe', Email: 'jane@example.test', Attendees: '1', Category: 'Nonexistent' },
      { name: 'Name', email: 'Email', attendees: 'Attendees', category: 'Category' },
      1,
    );
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('New category "Nonexistent" will be created.');
    expect(result.categoryId).toBeUndefined();
  });

  it('rejects an invalid volunteer email', () => {
    const row = extractRow(
      { 'Volunteer Email': 'not-valid' },
      { volunteerEmail: 'Volunteer Email' },
      1,
    );
    const result = validateRow(row, categoryIdByName);
    expect(result.errors).toContain('Invalid volunteer email.');
  });

  it('treats a malformed phone number as a warning, not an error', () => {
    const row = extractRow({ WhatsApp: '###not-a-phone###' }, { whatsapp: 'WhatsApp' }, 1);
    const result = validateRow(row, categoryIdByName);
    expect(result.warnings).toContain('Malformed phone number.');
  });
});

describe('detectDuplicates', () => {
  it('flags duplicate emails within the same batch as warnings', () => {
    const rows = [
      extractRow({ Email: 'same@example.test' }, { email: 'Email' }, 1),
      extractRow({ Email: 'same@example.test' }, { email: 'Email' }, 2),
      extractRow({ Email: 'unique@example.test' }, { email: 'Email' }, 3),
    ];
    const { duplicateFlags, duplicateWarnings } = detectDuplicates(rows, new Set(), new Set());

    expect(duplicateFlags).toEqual([true, true, false]);
    expect(duplicateWarnings[0]).toContain('Duplicate email within this import file.');
  });

  it('flags emails that already exist in the database', () => {
    const rows = [extractRow({ Email: 'existing@example.test' }, { email: 'Email' }, 1)];
    const { duplicateFlags, duplicateWarnings } = detectDuplicates(
      rows,
      new Set(['existing@example.test']),
      new Set(),
    );

    expect(duplicateFlags).toEqual([true]);
    expect(duplicateWarnings[0]).toContain('Duplicate email: already registered for this event.');
  });

  it('flags duplicate phone numbers the same way as emails', () => {
    const rows = [
      extractRow({ WhatsApp: '5551234567' }, { whatsapp: 'WhatsApp' }, 1),
      extractRow({ WhatsApp: '5551234567' }, { whatsapp: 'WhatsApp' }, 2),
    ];
    const { duplicateFlags } = detectDuplicates(rows, new Set(), new Set());
    expect(duplicateFlags).toEqual([true, true]);
  });
});
