import { z } from 'zod';

/** REQUIREMENTS.md Section 46 - QR scanner validation request. */
export const validateQrSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
});

/** REQUIREMENTS.md Section 47 - check-in request. */
export const createCheckinSchema = z.object({
  registrationId: z.string().uuid(),
  attendeeCount: z.number().int().positive(),
  counterName: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1).optional(),
});

/**
 * REQUIREMENTS.md Section 27/47 - supervisor override of an over-check-in.
 * A reason is mandatory (Section 27: "Override must require: Supervisor
 * role, Reason, Audit record").
 */
export const overrideCheckinSchema = z.object({
  registrationId: z.string().uuid(),
  attendeeCount: z.number().int().positive(),
  counterName: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1, 'A reason is required to override a check-in.'),
});

/** REQUIREMENTS.md Section 80 - check-in reversal, also requires a reason. */
export const reverseCheckinSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required to reverse a check-in.'),
});

export type ValidateQrInput = z.infer<typeof validateQrSchema>;
export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;
export type OverrideCheckinInput = z.infer<typeof overrideCheckinSchema>;
export type ReverseCheckinInput = z.infer<typeof reverseCheckinSchema>;
