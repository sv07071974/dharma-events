import type { User } from '@dharma-events/database';

/**
 * Public-facing user shape. Never includes `passwordHash` -
 * REQUIREMENTS.md Section 75 acceptance criteria: "Password hashes are
 * never returned."
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
