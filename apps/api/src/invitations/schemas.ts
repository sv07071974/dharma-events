import { z } from 'zod';

/**
 * Optional selection of specific registration IDs for "Send Selected"
 * (REQUIREMENTS.md Section 18). Omitting `registrationIds` targets every
 * currently "ready" registration ("Send All Ready").
 */
export const sendInvitationsSchema = z.object({
  registrationIds: z.array(z.string().uuid()).min(1).optional(),
});

export type SendInvitationsInput = z.infer<typeof sendInvitationsSchema>;
