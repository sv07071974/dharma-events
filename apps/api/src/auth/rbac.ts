import { Role } from '@dharma-events/database';

/**
 * Role hierarchy used for "ROLE+" style authorization checks
 * (REQUIREMENTS.md Section 35 - Authorization), e.g. "SUPERVISOR+" means
 * SUPERVISOR, EVENT_MANAGER or ADMIN.
 */
const ROLE_RANK: Record<Role, number> = {
  [Role.VOLUNTEER]: 1,
  [Role.SUPERVISOR]: 2,
  [Role.EVENT_MANAGER]: 3,
  [Role.ADMIN]: 4,
};

export function roleSatisfies(role: Role, minimumRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}
