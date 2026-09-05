import { z } from 'zod';
import { EventStatus } from '@dharma-events/database';

/**
 * Event/category/volunteer request schemas (REQUIREMENTS.md Section 12.2-12.4,
 * Section 76 - Phase 2 Event Management).
 */

export const createEventSchema = z.object({
  eventCode: z.string().trim().min(1, 'Event code is required.'),
  eventName: z.string().trim().min(1, 'Event name is required.'),
  description: z.string().trim().optional(),
  eventDate: z.coerce.date({ errorMap: () => ({ message: 'A valid event date is required.' }) }),
  venue: z.string().trim().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  registrationOpen: z.boolean().optional(),
  checkinOpen: z.boolean().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  description: z.string().trim().optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createVolunteerSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Volunteer name is required.'),
  email: z.string().trim().toLowerCase().email('A valid email address is required.'),
  phone: z.string().trim().optional(),
  role: z.string().trim().min(1, 'Volunteer role/duty is required.'),
  active: z.boolean().optional(),
});

export const updateVolunteerSchema = createVolunteerSchema.partial();

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateVolunteerInput = z.infer<typeof createVolunteerSchema>;
export type UpdateVolunteerInput = z.infer<typeof updateVolunteerSchema>;
