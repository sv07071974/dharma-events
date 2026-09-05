import { z } from 'zod';

/**
 * Registration CRUD request schemas (REQUIREMENTS.md Section 12.5,
 * Section 43 - Registration APIs).
 *
 * `registrationNo` is deliberately never accepted from clients - Section 6
 * requires registration numbers to be system-generated and to never change.
 */
export const createRegistrationSchema = z.object({
  name: z.string().trim().min(1, 'Participant name is required.'),
  email: z.string().trim().toLowerCase().email('A valid participant email is required.'),
  phone: z.string().trim().optional(),
  registeredCount: z.coerce.number().int().positive('Number of attendees must be a positive number.'),
  categoryId: z.string().uuid('A valid category is required.'),
  volunteerId: z.string().uuid().optional(),
  sourceTimestamp: z.coerce.date().optional(),
  notes: z.string().trim().optional(),
});

export const updateRegistrationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().optional(),
  registeredCount: z.coerce.number().int().positive().optional(),
  categoryId: z.string().uuid().optional(),
  volunteerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().optional(),
});

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;

/**
 * The standardized import column set (REQUIREMENTS.md Section 5).
 */
export const STANDARD_IMPORT_FIELDS = [
  'timestamp',
  'email',
  'name',
  'whatsapp',
  'attendees',
  'category',
  'volunteerName',
  'volunteerEmail',
] as const;

export type StandardImportField = (typeof STANDARD_IMPORT_FIELDS)[number];

export const columnMappingSchema = z
  .record(z.enum(STANDARD_IMPORT_FIELDS), z.string())
  .optional();

export type ColumnMapping = Partial<Record<StandardImportField, string>>;
